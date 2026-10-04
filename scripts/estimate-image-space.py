"""Count compressed blobs and unpacked layers without extracting any files."""
import sys
import tarfile
import zlib


def estimate_bytes(fileobj):
    stored = unpacked = 0
    with tarfile.open(fileobj=fileobj, mode="r|gz") as archive:
        for member in archive:
            if not member.isfile():
                continue
            stored += member.size
            stream = archive.extractfile(member)
            prefix = stream.read(2)
            if prefix != b"\x1f\x8b":
                unpacked += member.size
                continue
            inflater = zlib.decompressobj(31)
            chunk = prefix
            while chunk:
                unpacked += len(inflater.decompress(chunk, 1024 * 1024))
                chunk = inflater.unconsumed_tail or stream.read(1024 * 1024)
            if not inflater.eof:
                raise ValueError("Incomplete compressed image layer")
    return stored + unpacked


if __name__ == "__main__":
    with open(sys.argv[1], "rb") as source:
        print(estimate_bytes(source))
