#!/usr/bin/env python3
"""Process smoke tests using loopback and deliberately invalid API payloads only.

Build the Linux binary first, then run this script with Python 3. No third-party
packages, production Worker requests, server access, or deployment are needed.
Use a CGO_ENABLED=0 relay binary; LYTVPK_RELAY_BIN may select its path.
"""

from contextlib import closing, contextmanager
import http.client
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
import unittest


SERVICE_ROOT = Path(__file__).resolve().parent
DEFAULT_BINARY = SERVICE_ROOT / "build/bin/lytvpk-relay-linux-amd64"
BINARY = Path(os.environ.get("LYTVPK_RELAY_BIN", DEFAULT_BINARY)).resolve()
# Keep normal runtime networking settings. Only isolate application configuration
# so a developer's RELAY_* values cannot change this test's local listeners.
BASE_ENV = {key: value for key, value in os.environ.items() if not key.startswith("RELAY_")}
BASE_ENV["RELAY_STATS_FILE"] = ""


def free_port(excluding=()):
    while True:
        with socket.socket() as connection:
            connection.bind(("127.0.0.1", 0))
            port = connection.getsockname()[1]
        if port not in excluding:
            return port


def request(port, method, path, body=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        headers = {"Content-Type": "application/json"} if body is not None else {}
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


class RunningRelay:
    def __init__(self, process, api_port, admin_port):
        self.process = process
        self.api_port = api_port
        self.admin_port = admin_port

    def wait_for_exit(self):
        _, stderr = self.process.communicate(timeout=5)
        return self.process.returncode, stderr


def wait_for_stats(relay, condition, timeout=3):
    deadline = time.monotonic() + timeout
    while True:
        status, body = request(relay.admin_port, "GET", "/stats")
        if status != 200:
            raise AssertionError(f"unexpected statistics status: {status}")
        snapshot = json.loads(body)
        if condition(snapshot):
            return snapshot
        if time.monotonic() >= deadline:
            raise AssertionError(f"statistics did not reach the expected state: {snapshot}")
        time.sleep(0.02)


def saved_statistics(snapshot):
    persistence = snapshot["persistence"]
    return bool(persistence.get("last_saved")) and persistence["last_saved"] != "0001-01-01T00:00:00Z"


@contextmanager
def running_relay(arguments=(), environment=None):
    api_port = free_port()
    admin_port = free_port(excluding=(api_port,))
    process = subprocess.Popen(
        [str(BINARY), "-listen", f"127.0.0.1:{api_port}",
         "-admin-listen", f"127.0.0.1:{admin_port}", *arguments],
        env=BASE_ENV | (environment or {}),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        deadline = time.monotonic() + 5
        while True:
            if process.poll() is not None:
                _, stderr = process.communicate(timeout=5)
                raise AssertionError(f"relay exited during startup: {stderr}")
            try:
                status, _ = request(api_port, "GET", "/healthz")
                if status != 200:
                    raise AssertionError(f"unexpected health status: {status}")
                break
            except (ConnectionError, OSError):
                if time.monotonic() >= deadline:
                    raise AssertionError("relay did not become ready in five seconds")
                time.sleep(0.01)
        yield RunningRelay(process, api_port, admin_port)
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=5)


@unittest.skipUnless(os.name == "posix", "SIGTERM process checks require a POSIX runtime")
class RelayProcessTests(unittest.TestCase):
    def test_configuration_rejections_and_help(self):
        for arguments in (("-version",), ("-help",)):
            with self.subTest(arguments=arguments):
                result = subprocess.run(
                    [str(BINARY), *arguments], env=BASE_ENV,
                    capture_output=True, text=True, timeout=5,
                )
                self.assertEqual(result.returncode, 0, result.stderr)

        cases = [
            (("-admin-listen", "0.0.0.0:18081"), {}),
            (("-listen", "127.0.0.1:0"), {}),
            (("-trusted-proxies", "0.0.0.0/0"), {}),
            (("-real-ip-header", "X-Forwarded-For"), {}),
            (("-max-queued", "0"), {}),
            (("-queue-timeout", "0s"), {}),
            (("-request-timeout", "11s"), {}),
            ((), {"RELAY_MAX_QUEUED": "invalid"}),
        ]
        for arguments, environment in cases:
            with self.subTest(arguments=arguments, environment=environment):
                result = subprocess.run(
                    [str(BINARY), *arguments], env=BASE_ENV | environment,
                    capture_output=True, text=True, timeout=5,
                )
                self.assertEqual(result.returncode, 1, result.stderr)

    def test_dual_listeners_precedence_isolation_and_statistics(self):
        unused_port = free_port()
        environment = {
            "RELAY_LISTEN": f"127.0.0.1:{unused_port}",
            "RELAY_TRUSTED_PROXIES": "127.0.0.1/32",
        }
        with running_relay(environment=environment) as relay:
            self.assertEqual(request(relay.admin_port, "GET", "/healthz")[0], 200)
            with socket.socket() as connection:
                self.assertNotEqual(connection.connect_ex(("127.0.0.1", unused_port)), 0)
            self.assertEqual(request(relay.api_port, "GET", "/stats")[0], 404)
            self.assertEqual(request(relay.admin_port, "GET", "/list")[0], 404)
            before = json.loads(request(relay.admin_port, "GET", "/stats")[1])
            self.assertIn("direct Worker traffic is excluded", before["scope"])
            self.assertIs(before["resets_on_restart"], True)

            # Each input is rejected locally, before constructing an upstream
            # request. Do not add successful API calls to this process suite.
            invalid_requests = [
                ("POST", "/parse", b"[]"),
                ("GET", "/detail?id=invalid", None),
                ("GET", "/list?url=https://example.invalid/", None),
                ("GET", "/ips?domain=example.invalid", None),
            ]
            for method, path, body in invalid_requests:
                self.assertEqual(request(relay.api_port, method, path, body)[0], 400)
            after = json.loads(request(relay.admin_port, "GET", "/stats")[1])
            self.assertEqual(after["total_requests"], before["total_requests"] + len(invalid_requests))
            self.assertEqual(after["forwarded_requests"], 0)

            relay.process.send_signal(signal.SIGTERM)
            returncode, stderr = relay.wait_for_exit()
            self.assertEqual(returncode, 0, stderr)
            for port in (relay.api_port, relay.admin_port):
                with socket.socket() as connection:
                    self.assertNotEqual(connection.connect_ex(("127.0.0.1", port)), 0)

    def test_bounded_queue_and_sigterm_drain(self):
        arguments = (
            "-max-concurrent", "1", "-max-concurrent-per-client", "1",
            "-max-queued", "1", "-max-queued-per-client", "1", "-queue-timeout", "2s",
        )
        # The CLI's single waiting slot must override the environment's two.
        environment = {
            "RELAY_MAX_QUEUED": "2", "RELAY_MAX_QUEUED_PER_CLIENT": "2",
            "RELAY_QUEUE_TIMEOUT": "3s",
        }
        with running_relay(arguments, environment) as relay:
            with socket.create_connection(("127.0.0.1", relay.api_port), timeout=3) as active:
                headers = (
                    b"POST /parse HTTP/1.1\r\nHost: localhost\r\n"
                    b"Content-Type: application/json\r\nContent-Length: 2\r\n"
                    b"Connection: close\r\n\r\n"
                )
                # Hold the active slot while reading an incomplete request body.
                # Completing [] later still fails validation without networking.
                active.sendall(headers + b"[")
                time.sleep(0.05)
                with socket.create_connection(("127.0.0.1", relay.api_port), timeout=3) as queued:
                    queued.sendall(headers + b"[]")
                    queued.settimeout(0.1)
                    with self.assertRaises(TimeoutError):
                        queued.recv(1)
                    queued.settimeout(3)
                    self.assertEqual(request(relay.api_port, "POST", "/parse", b"[]")[0], 429)

                    relay.process.send_signal(signal.SIGTERM)
                    time.sleep(0.05)
                    self.assertIsNone(relay.process.poll(), "SIGTERM did not wait for the active request")
                    active.sendall(b"]")
                    for connection in (active, queued):
                        response = http.client.HTTPResponse(connection)
                        try:
                            response.begin()
                            self.assertEqual(response.status, 400)
                            response.read()
                        finally:
                            response.close()
                    returncode, stderr = relay.wait_for_exit()
                    self.assertEqual(returncode, 0, stderr)

    def test_zero_capacities_disable_queuing(self):
        environment = {"RELAY_MAX_QUEUED": "0", "RELAY_MAX_QUEUED_PER_CLIENT": "0"}
        with running_relay(environment=environment) as relay:
            self.assertEqual(request(relay.admin_port, "GET", "/stats")[0], 200)
            relay.process.send_signal(signal.SIGTERM)
            returncode, stderr = relay.wait_for_exit()
            self.assertEqual(returncode, 0, stderr)

    def test_total_budget_interrupts_slow_body(self):
        with running_relay(("-request-timeout", "300ms")) as relay:
            with socket.create_connection(("127.0.0.1", relay.api_port), timeout=2) as connection:
                started = time.monotonic()
                connection.sendall(
                    b"POST /parse HTTP/1.1\r\nHost: localhost\r\n"
                    b"Content-Type: application/json\r\nContent-Length: 2\r\n"
                    b"Connection: close\r\n\r\n["
                )
                response = http.client.HTTPResponse(connection)
                try:
                    response.begin()
                    self.assertEqual(response.status, 504)
                    response.read()
                finally:
                    response.close()
                self.assertLess(time.monotonic() - started, 1.5)
            self.assertEqual(request(relay.api_port, "GET", "/healthz")[0], 200)
            self.assertEqual(request(relay.api_port, "POST", "/parse", b"[]")[0], 400)
            snapshot = json.loads(request(relay.admin_port, "GET", "/stats")[1])
            self.assertEqual(snapshot["forwarded_requests"], 0)

    def test_statistics_survive_restart_and_reuse_daily_identity(self):
        with tempfile.TemporaryDirectory(prefix="lytvpk-relay-stats-") as directory:
            checkpoint = Path(directory) / "stats.sqlite3"
            environment = {
                "RELAY_STATS_FILE": str(checkpoint), "RELAY_STATS_FLUSH_INTERVAL": "100ms",
            }
            with running_relay(environment=environment) as relay:
                baseline = wait_for_stats(relay, lambda value: value["persistence"]["ready"])
                self.assertEqual(request(relay.api_port, "GET", "/detail?id=invalid")[0], 400)
                recorded = json.loads(request(relay.admin_port, "GET", "/stats")[1])
                self.assertEqual(recorded["total_requests"], baseline["total_requests"] + 1)
                relay.process.send_signal(signal.SIGTERM)
                returncode, stderr = relay.wait_for_exit()
                self.assertEqual(returncode, 0, stderr)
            self.assertTrue(checkpoint.is_file(), "clean shutdown did not save statistics")
            self.assertEqual(checkpoint.read_bytes()[:16], b"SQLite format 3\x00")
            self.assertLessEqual(checkpoint.stat().st_size, 2 << 20)
            with closing(sqlite3.connect(checkpoint.as_uri() + "?mode=ro", uri=True, timeout=0.2)) as database:
                self.assertEqual(database.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
                self.assertEqual(database.execute("PRAGMA journal_mode").fetchone()[0].lower(), "delete")
                tables = {
                    row[0] for row in database.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                    )
                }
                self.assertTrue(
                    {"meta", "cumulative", "daily", "route_counts", "status_counts", "sketches"} <= tables,
                    f"missing normalized SQLite tables: {tables}",
                )
                aggregate = database.execute("SELECT total_requests FROM cumulative WHERE id=1").fetchone()
                self.assertIsNotNone(aggregate, "SQLite cumulative table did not contain aggregate statistics")
                self.assertEqual(int(aggregate[0]), recorded["total_requests"])

            with running_relay(environment=environment) as relay:
                restored = wait_for_stats(relay, lambda value: value["persistence"]["ready"])
                self.assertIs(restored["persistence"]["restored"], True)
                self.assertIs(restored["resets_on_restart"], False)
                self.assertEqual(restored["total_requests"], recorded["total_requests"])
                self.assertEqual(restored["anonymous_users"]["estimate"], recorded["anonymous_users"]["estimate"])
                self.assertEqual(request(relay.api_port, "GET", "/detail?id=invalid")[0], 400)
                after = json.loads(request(relay.admin_port, "GET", "/stats")[1])
                self.assertEqual(after["total_requests"], restored["total_requests"] + 1)
                self.assertEqual(after["anonymous_users"]["estimate"], restored["anonymous_users"]["estimate"])
                relay.process.send_signal(signal.SIGTERM)
                returncode, stderr = relay.wait_for_exit()
                self.assertEqual(returncode, 0, stderr)

    def test_corrupt_database_is_preserved_while_api_remains_available(self):
        with tempfile.TemporaryDirectory(prefix="lytvpk-relay-corrupt-sqlite-") as directory:
            checkpoint = Path(directory) / "stats.sqlite3"
            original = b"deliberately invalid SQLite database\x00"
            checkpoint.write_bytes(original)
            environment = {
                "RELAY_STATS_FILE": str(checkpoint), "RELAY_STATS_FLUSH_INTERVAL": "100ms",
            }
            with running_relay(environment=environment) as relay:
                snapshot = wait_for_stats(relay, lambda value: value["persistence"]["ready"])
                self.assertTrue(snapshot["persistence"]["load_error"])
                self.assertEqual(request(relay.api_port, "GET", "/healthz")[0], 200)
                self.assertEqual(request(relay.api_port, "POST", "/parse", b"[]")[0], 400)
                wait_for_stats(relay, lambda value: bool(value["persistence"].get("save_error")))
                relay.process.send_signal(signal.SIGTERM)
                returncode, stderr = relay.wait_for_exit()
                self.assertEqual(returncode, 0, stderr)
            self.assertEqual(checkpoint.read_bytes(), original, "failed loading must preserve the original database")

    def test_database_lock_does_not_block_api_and_saving_recovers(self):
        with tempfile.TemporaryDirectory(prefix="lytvpk-relay-locked-sqlite-") as directory:
            checkpoint = Path(directory) / "stats.sqlite3"
            environment = {
                "RELAY_STATS_FILE": str(checkpoint), "RELAY_STATS_FLUSH_INTERVAL": "100ms",
            }
            with running_relay(environment=environment) as relay:
                saved = wait_for_stats(relay, saved_statistics)
                with closing(sqlite3.connect(checkpoint, timeout=0.2)) as lock:
                    lock.execute("BEGIN EXCLUSIVE")
                    started = time.monotonic()
                    self.assertEqual(request(relay.api_port, "POST", "/parse", b"[]")[0], 400)
                    self.assertEqual(request(relay.api_port, "GET", "/healthz")[0], 200)
                    self.assertLess(time.monotonic() - started, 1)
                    wait_for_stats(relay, lambda value: bool(value["persistence"].get("save_error")))
                    lock.rollback()
                recovered = wait_for_stats(
                    relay,
                    lambda value: not value["persistence"].get("save_error")
                    and value["persistence"]["last_saved"] != saved["persistence"]["last_saved"],
                )
                self.assertEqual(recovered["total_requests"], 1)
                relay.process.send_signal(signal.SIGTERM)
                returncode, stderr = relay.wait_for_exit()
                self.assertEqual(returncode, 0, stderr)

    def test_broken_storage_does_not_block_requests(self):
        with tempfile.TemporaryDirectory(prefix="lytvpk-relay-bad-stats-") as directory:
            blocker = Path(directory) / "not-a-directory"
            blocker.write_text("regular file", encoding="utf-8")
            environment = {
                "RELAY_STATS_FILE": str(blocker / "stats.sqlite3"),
                "RELAY_STATS_FLUSH_INTERVAL": "100ms",
            }
            with running_relay(environment=environment) as relay:
                snapshot = wait_for_stats(relay, lambda value: value["persistence"]["ready"])
                self.assertTrue(snapshot["persistence"]["load_error"])
                self.assertEqual(request(relay.api_port, "GET", "/healthz")[0], 200)
                self.assertEqual(request(relay.api_port, "POST", "/parse", b"[]")[0], 400)
                wait_for_stats(relay, lambda value: bool(value["persistence"].get("save_error")))
                relay.process.send_signal(signal.SIGTERM)
                returncode, stderr = relay.wait_for_exit()
                self.assertEqual(returncode, 0, stderr)

    def test_admin_bind_failure_releases_api_listener(self):
        with socket.socket() as busy:
            busy.bind(("127.0.0.1", 0))
            busy.listen()
            admin_port = busy.getsockname()[1]
            api_port = free_port(excluding=(admin_port,))
            result = subprocess.run(
                [str(BINARY), "-listen", f"127.0.0.1:{api_port}",
                 "-admin-listen", f"127.0.0.1:{admin_port}"],
                env=BASE_ENV, capture_output=True, text=True, timeout=5,
            )
            self.assertEqual(result.returncode, 1, result.stderr)
            with socket.socket() as connection:
                self.assertNotEqual(connection.connect_ex(("127.0.0.1", api_port)), 0)


if __name__ == "__main__":
    if not BINARY.is_file() or not os.access(BINARY, os.X_OK):
        raise SystemExit(f"Build the relay binary first, or set LYTVPK_RELAY_BIN; not executable: {BINARY}")
    unittest.main(verbosity=2)
