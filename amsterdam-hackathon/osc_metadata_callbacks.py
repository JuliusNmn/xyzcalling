"""Optional OSC In DAT callback; requires sibling Table DAT osc_metadata_latest.

Discovery heuristic only. Does not prove values are unique or currently loaded IDs.
"""

import json
import time


def onReceiveOSC(dat, rowIndex, message, bytes, timeStamp, address, args, peer):
    words = ('title', 'artist', 'album', 'track', 'uuid', 'isrc', 'source', 'uri')
    if not any(word in address.lower() for word in words) and not any(
            isinstance(value, str) for value in args):
        return
    table = dat.parent().op('osc_metadata_latest')
    if table is None:
        return
    if table.numRows == 0:
        table.appendRow(['address', 'arguments_json', 'received_unix_s'])
    values = json.dumps(args, ensure_ascii=True, default=repr)
    if len(values) > 4096 or len(address) > 1024:
        return
    cell = table[address, 0]
    if cell is None:
        if table.numRows < 513:
            table.appendRow([address, values, str(time.time())])
    else:
        table[cell.row, 1] = values
        table[cell.row, 2] = str(time.time())
