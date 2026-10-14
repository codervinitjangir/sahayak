from fakeredis import TcpFakeServer

if __name__ == "__main__":
    server = TcpFakeServer(("127.0.0.1", 6379))
    print("FakeRedis TCP server listening on 127.0.0.1:6379", flush=True)
    server.serve_forever()
