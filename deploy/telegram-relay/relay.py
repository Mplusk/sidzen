"""Opaque TLS tunnel, not a Bot API server. No tokens or request bodies logged."""
import asyncio
import os

ALLOWED_IP = os.environ.get("SHOP_SOURCE_IP", "92.63.101.127")
LISTEN_IP = os.environ.get("RELAY_LISTEN_IP", "185.196.41.131")
PORT = int(os.environ.get("RELAY_PORT", "18443"))
MAX_CONNECTIONS = 16
active = 0


def permitted(peer, request):
    return peer == ALLOWED_IP and request == b"CONNECT api.telegram.org:443 HTTP/1.1"


async def pump(reader, writer):
    while True:
        data = await asyncio.wait_for(reader.read(16384), 30)
        if not data:
            return
        writer.write(data)
        await asyncio.wait_for(writer.drain(), 10)


async def handle(reader, writer):
    global active
    upstream = None
    tasks = []
    counted = False
    try:
        peer = writer.get_extra_info("peername")[0]
        if peer != ALLOWED_IP or active >= MAX_CONNECTIONS:
            writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
            return
        active += 1
        counted = True
        header = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
        if len(header) > 4096 or not permitted(peer, header.split(b"\r\n", 1)[0]):
            writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
            return
        remote_reader, upstream = await asyncio.wait_for(asyncio.open_connection("api.telegram.org", 443, family=2), 8)
        writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await writer.drain()
        tasks = [asyncio.create_task(pump(reader, upstream)), asyncio.create_task(pump(remote_reader, writer))]
        await asyncio.wait(tasks, timeout=120, return_when=asyncio.FIRST_COMPLETED)
    except (OSError, ValueError, asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
        pass  # Never log arbitrary client bytes, credentials or URLs.
    finally:
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if upstream:
            upstream.close()
        writer.close()
        if counted:
            active -= 1


async def main():
    server = await asyncio.start_server(handle, LISTEN_IP, PORT, limit=4096, backlog=32)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
