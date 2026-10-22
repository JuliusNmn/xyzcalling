import {toBuffer} from 'osc-min';
// osc-min v2 returns DataView, which Buffer.from(view) silently converts to an empty Buffer.
export function encodeOsc(message){const view=toBuffer(message);return Buffer.from(view.buffer,view.byteOffset,view.byteLength);}
