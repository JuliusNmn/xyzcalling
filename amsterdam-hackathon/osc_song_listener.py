"""Print djay song metadata received over OSC/UDP, without modifying djay."""

import argparse
import json

from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import BlockingOSCUDPServer


SONG_FIELDS = (
    'loaded', 'duration', 'title', 'artist', 'album', 'genre',
    'artworkAvailable', 'key', 'bpm',
)


def print_song_message(address, *args):
    """Print the address and every argument; retain literal metadata escapes."""
    print(f'{address}: {json.dumps(args, ensure_ascii=True)}', flush=True)


def create_dispatcher(deck=None):
    """Listen to all decks by default, or a specific positive deck number."""
    if deck is not None and (type(deck) is not int or deck < 1):
        raise ValueError('Deck must be a positive integer or None for all decks')
    dispatcher = Dispatcher()
    prefix = f'/djay/turntable{deck if deck is not None else "*"}/song'
    for field in SONG_FIELDS:
        dispatcher.map(f'{prefix}/{field}', print_song_message)
    return dispatcher


class ExclusiveOSCServer(BlockingOSCUDPServer):
    # A second receiver must not silently share or steal TouchDesigner's socket.
    allow_reuse_address = False
    allow_reuse_port = False


def create_server(host='127.0.0.1', port=10002, deck=None):
    return ExclusiveOSCServer((host, port), create_dispatcher(deck))


def listen_for_song_messages(host='127.0.0.1', port=10002, deck=None):
    """Block and print matching live messages until Ctrl+C; release the port."""
    with create_server(host, port, deck) as server:
        print(f'Listening for djay song messages on {host}:{server.server_address[1]}',
              flush=True)
        print('Load a track in djay to trigger metadata. Stop with Ctrl+C.', flush=True)
        try:
            server.serve_forever(poll_interval=0.1)
        except KeyboardInterrupt:
            print('\nListener stopped.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=10002)
    parser.add_argument('--deck', type=int, help='Only this deck; default: all decks')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('--port must be between 1 and 65535')
    if args.deck is not None and args.deck < 1:
        parser.error('--deck must be a positive integer')
    try:
        listen_for_song_messages(args.host, args.port, args.deck)
    except OSError as error:
        parser.exit(1, f'Cannot listen on {args.host}:{args.port}: {error}\n'
                    'Use a free port and set djay Target Port to the same value.\n')


if __name__ == '__main__':
    main()
