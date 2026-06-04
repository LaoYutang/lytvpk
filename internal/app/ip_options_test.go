package app

import (
	"testing"

	"vpk-manager/internal/network"
)

func TestGetCurrentBestIPOptionReturnsFixedIPCategory(t *testing.T) {
	app := newConfigTestApp(t)
	network.GlobalIPSelector = &network.IPSelector{}
	network.GlobalIPSelector.SetIPOptions([]network.IPOption{
		{IP: "23.55.51.221", Category: "steam官方-日本"},
	})
	t.Cleanup(func() {
		network.GlobalIPSelector = &network.IPSelector{}
	})

	app.SetWorkshopFixedIP("23.55.51.221")

	option := app.GetCurrentBestIPOption()
	if option.IP != "23.55.51.221" || option.Category != "steam官方-日本" {
		t.Fatalf("expected fixed IP category, got %#v", option)
	}
}
