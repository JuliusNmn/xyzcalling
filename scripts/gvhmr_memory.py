"""Bound crop decoding and attention memory without truncating clip context."""
import math


def bounded_attention(self, x, attn_mask=None, key_padding_mask=None):
    import torch
    b, length, _ = x.shape
    q, k, v = [projection(x).reshape(b, length, self.num_heads, -1).transpose(1, 2)
               for projection in (self.query, self.key, self.value)]
    q, k = self.rope.rotate_queries_or_keys(q), self.rope.rotate_queries_or_keys(k)
    parts = []
    for start in range(0, length, 128):
        stop = min(start + 128, length)
        scores = torch.einsum('bhic,bhjc->bhij', q[:, :, start:stop], k) / math.sqrt(self.head_dim)
        if attn_mask is not None:
            scores = scores.masked_fill(attn_mask[None, None, start:stop, :], float('-inf'))
        if key_padding_mask is not None:
            scores = scores.masked_fill(key_padding_mask[:, None, None, :], float('-inf'))
        parts.append(torch.einsum('bhij,bhjc->bhic', self.dropout(torch.softmax(scores, dim=-1)), v))
    return self.proj(torch.cat(parts, dim=2).transpose(1, 2).reshape(b, length, -1))


def install():
    import hmr4d.utils.preproc.vitfeat_extractor as vf
    from hmr4d.network.base_arch.transformer.encoder_rope import RoPEAttention
    import imageio.v3 as iio
    import numpy as np

    if getattr(vf, '_bounded_crops_installed', False):
        return
    original_get_batch = vf.get_batch
    original_attention = RoPEAttention.forward

    class SequentialCrops:
        def __init__(self, path, boxes, scale):
            self.boxes, self.scale, self.position = boxes, scale, 0
            self.reader = iter(iio.imiter(path, plugin='pyav',
                                         filter_sequence=[('scale', f'iw*{scale}:ih*{scale}')]))

        def __len__(self):
            return len(self.boxes)

        def __getitem__(self, key):
            if not isinstance(key, slice) or key.start != self.position or key.step is not None:
                raise ValueError('Crops must be consumed in sequential batches')
            end = min(key.stop, len(self))
            frames = np.stack([next(self.reader) for _ in range(end - self.position)])
            batch, _ = original_get_batch(frames, self.boxes[self.position:end] * self.scale,
                                          img_ds=1.0, path_type='np')
            self.position = end
            if end == len(self):
                self.reader.close()
            return batch

    def streaming_batch(path, boxes, img_ds=0.5, **kwargs):
        return SequentialCrops(path, boxes, img_ds), boxes

    def attention(self, x, attn_mask=None, key_padding_mask=None):
        if self.training or x.shape[1] <= 2048:
            return original_attention(self, x, attn_mask, key_padding_mask)
        return bounded_attention(self, x, attn_mask, key_padding_mask)

    vf.get_batch = streaming_batch
    vf._bounded_crops_installed = True
    RoPEAttention.forward = attention
