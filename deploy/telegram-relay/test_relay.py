import asyncio
import unittest
from unittest.mock import patch
import relay


class RelayPolicy(unittest.TestCase):
    def test_only_exact_source_and_destination(self):
        self.assertTrue(relay.permitted(relay.ALLOWED_IP, b"CONNECT api.telegram.org:443 HTTP/1.1"))
        for target in [b"CONNECT example.com:443 HTTP/1.1", b"CONNECT api.telegram.org:80 HTTP/1.1", b"GET https://api.telegram.org/ HTTP/1.1", b"CONNECT api.telegram.org.evil:443 HTTP/1.1"]:
            self.assertFalse(relay.permitted(relay.ALLOWED_IP, target))
        self.assertFalse(relay.permitted("198.51.100.1", b"CONNECT api.telegram.org:443 HTTP/1.1"))


class RelayNetwork(unittest.IsolatedAsyncioTestCase):
    async def test_rejected_request_never_opens_upstream(self):
        with patch.object(relay, "ALLOWED_IP", "127.0.0.1"):
            server = await asyncio.start_server(relay.handle, "127.0.0.1", 0, limit=4096)
            async with server:
                reader, writer = await asyncio.open_connection("127.0.0.1", server.sockets[0].getsockname()[1])
                writer.write(b"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n")
                await writer.drain()
                self.assertIn(b"403 Forbidden", await asyncio.wait_for(reader.read(), 2))
                writer.close()
                await writer.wait_closed()
        self.assertEqual(relay.active, 0)


if __name__ == "__main__":
    unittest.main()
