"""OSC In DAT callback: keep latest values in a sibling Table DAT song_state."""

import json


def onReceiveOSC(dat, rowIndex, message, bytes, timeStamp, address, args, peer):
    table = dat.parent().op('song_state')
    if table is None:
        raise RuntimeError('Create a sibling Table DAT named song_state first')
    if table.numRows == 0:
        table.appendRow(['address', 'value'])

    value = args[0] if len(args) == 1 else json.dumps(args, default=repr)
    if table[address, 0] is None:
        table.appendRow([address, value])
    else:
        table[address, 1] = value
