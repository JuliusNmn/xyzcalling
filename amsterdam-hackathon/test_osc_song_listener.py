import contextlib
import io
import json
import unittest

from pythonosc.osc_message_builder import OscMessageBuilder
from pythonosc.udp_client import SimpleUDPClient

from osc_song_listener import SONG_FIELDS, create_dispatcher, create_server


def message(address, *args):
    builder = OscMessageBuilder(address=address)
    for value in args:
        builder.add_arg(value)
    return builder.build().dgram


class SongListenerTests(unittest.TestCase):
    def dispatch(self, dispatcher, address, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            dispatcher.call_handlers_for_packet(message(address, *args), ('127.0.0.1', 1234))
        return output.getvalue()

    def test_every_requested_field(self):
        dispatcher = create_dispatcher()
        for field in SONG_FIELDS:
            with self.subTest(field=field):
                address = f'/djay/turntable1/song/{field}'
                self.assertTrue(self.dispatch(dispatcher, address, 1).startswith(address + ': '))

    def test_all_decks_and_optional_deck_filter(self):
        address = '/djay/turntable2/song/title'
        self.assertIn('Example', self.dispatch(create_dispatcher(), address, 'Example'))
        self.assertEqual(self.dispatch(create_dispatcher(1), address, 'Example'), '')

    def test_unlisted_controls_are_ignored(self):
        dispatcher = create_dispatcher()
        self.assertEqual(self.dispatch(dispatcher, '/djay/turntable1/volume', 0.5), '')
        self.assertEqual(self.dispatch(dispatcher, '/djay/turntable1/song/unknown', 1), '')

    def test_string_escapes_and_all_arguments_are_preserved(self):
        value = r'Sch\366n'
        output = self.dispatch(create_dispatcher(), '/djay/turntable1/song/title', value, 42)
        self.assertEqual(json.loads(output.split(': ', 1)[1]), [value, 42])

    def test_invalid_decks(self):
        for deck in (0, -1, True, '1'):
            with self.subTest(deck=deck), self.assertRaises(ValueError):
                create_dispatcher(deck)

    def test_real_udp_receive_and_port_exclusivity(self):
        with create_server(port=0) as server:
            server.timeout = 2
            port = server.server_address[1]
            with self.assertRaises(OSError):
                with create_server(port=port):
                    pass
            with SimpleUDPClient('127.0.0.1', port) as client:
                client.send_message('/djay/turntable1/song/bpm', 92.5)
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    server.handle_request()
                self.assertIn('/djay/turntable1/song/bpm: [92.5]', output.getvalue())


if __name__ == '__main__':
    unittest.main()
