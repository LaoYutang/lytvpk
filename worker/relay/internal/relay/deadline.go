package relay

import (
	"context"
	"errors"
	"net/http"
	"time"
)

type requestResponseWriter struct {
	http.ResponseWriter
	writeError error
}

func (w *requestResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *requestResponseWriter) Write(body []byte) (int, error) {
	n, err := w.ResponseWriter.Write(body)
	if err != nil {
		w.writeError = err
	}
	return n, err
}

func (w *requestResponseWriter) flush() {
	if err := http.NewResponseController(w).Flush(); err != nil && !errors.Is(err, http.ErrNotSupported) {
		w.writeError = err
	}
}

// withRequestDeadline shares one budget across admission, body reads, upstream
// I/O and the downstream write. A small part of that same budget is reserved
// for sending a timeout response. The socket write deadline is never extended.
func withRequestDeadline(w http.ResponseWriter, r *http.Request, timeout time.Duration) (*http.Request, func()) {
	deadline := time.Now().Add(timeout)
	if inherited, ok := r.Context().Deadline(); ok && inherited.Before(deadline) {
		deadline = inherited
	}
	remaining := max(time.Duration(0), time.Until(deadline))
	responseReserve := min(100*time.Millisecond, remaining/10)
	processingDeadline := deadline.Add(-responseReserve)
	ctx, cancel := context.WithDeadline(r.Context(), processingDeadline)
	controller := http.NewResponseController(w)
	readDeadlineError := controller.SetReadDeadline(processingDeadline)
	_ = controller.SetWriteDeadline(deadline)
	// The production net/http writer supports socket deadlines. This fallback
	// also lets cancellable custom request bodies stop in embedders and tests.
	stopBody := context.AfterFunc(ctx, func() {
		if readDeadlineError != nil && r.Body != nil {
			_ = r.Body.Close()
		}
	})
	return r.WithContext(ctx), func() {
		stopBody()
		cancel()
	}
}

func requestDeadlineExceeded(ctx context.Context) bool {
	deadline, ok := ctx.Deadline()
	return ok && !time.Now().Before(deadline)
}
