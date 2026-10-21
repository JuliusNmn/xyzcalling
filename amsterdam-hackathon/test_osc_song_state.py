import types
import unittest

from osc_song_state_callbacks import onReceiveOSC


class Table:
    def __init__(self):
        self.rows = []

    @property
    def numRows(self):
        return len(self.rows)

    def appendRow(self, values):
        self.rows.append([str(value) for value in values])

    def __getitem__(self, key):
        name, column = key
        return next((types.SimpleNamespace(row=i) for i, row in enumerate(self.rows)
                     if row[0] == name), None)

    def __setitem__(self, key, value):
        name, column = key
        row = next(row for row in self.rows if row[0] == name)
        row[column] = str(value)


class StateTests(unittest.TestCase):
    def setUp(self):
        self.table = Table()
        self.dat = types.SimpleNamespace(parent=lambda: types.SimpleNamespace(
            op=lambda name: self.table if name == 'song_state' else None))

    def receive(self, address, *args):
        onReceiveOSC(self.dat, 1, '', b'', None, address, args, None)

    def test_replaces_instead_of_appending(self):
        address = '/djay/turntable1/song/title'
        self.receive(address, 'First song')
        self.receive(address, 'Next song')
        self.assertEqual(self.table.rows, [['address', 'value'], [address, 'Next song']])

    def test_other_fields_and_decks_survive(self):
        self.receive('/djay/turntable1/song/artist', 'SSIO')
        self.receive('/djay/turntable2/song/title', 'Second deck')
        self.receive('/djay/turntable1/song/bpm', 93)
        self.receive('/djay/turntable1/song/bpm', 0)
        self.assertEqual(len(self.table.rows), 4)
        self.assertEqual(self.table.rows[1][1], 'SSIO')
        self.assertEqual(self.table.rows[2][1], 'Second deck')
        self.assertEqual(self.table.rows[3][1], '0')

    def test_escape_sequences_are_not_modified(self):
        self.receive('/djay/turntable1/song/title', r'H\366r Dir')
        self.assertEqual(self.table.rows[1][1], r'H\366r Dir')

    def test_missing_table_is_explicit(self):
        self.dat.parent = lambda: types.SimpleNamespace(op=lambda name: None)
        with self.assertRaisesRegex(RuntimeError, 'song_state'):
            self.receive('/djay/turntable1/song/title', 'Example')


if __name__ == '__main__':
    unittest.main()
