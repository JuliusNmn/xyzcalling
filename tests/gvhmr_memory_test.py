"""Compare query-chunked attention to upstream, including both mask types."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'scripts'), str(ROOT / 'artifacts/GVHMR')]
import torch
from hmr4d.network.base_arch.transformer.encoder_rope import RoPEAttention
from gvhmr_memory import bounded_attention


class AttentionTests(unittest.TestCase):
    def test_full_context_and_masks(self):
        torch.manual_seed(19)
        model = RoPEAttention(32, 4).eval()
        x = torch.randn(2, 273, 32)
        causal = torch.ones(273, 273, dtype=torch.bool).triu(1)
        padding = torch.zeros(2, 273, dtype=torch.bool)
        padding[0, -7:] = True
        with torch.no_grad():
            for mask, pad in [(None, None), (causal, None), (None, padding), (causal, padding)]:
                expected = model(x, mask, pad)
                actual = bounded_attention(model, x, mask, pad)
                torch.testing.assert_close(actual, expected, atol=1e-6, rtol=1e-5)


if __name__ == '__main__':
    unittest.main()
