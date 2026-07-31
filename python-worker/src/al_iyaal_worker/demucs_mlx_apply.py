"""Vocals-only separation loop for Demucs MLX.

demucs-mlx's ``apply_model`` accumulates all four stems into a full-length
output array, but the worker only consumes vocals. This module replicates the
library's shift/split schedule (via its own ``TensorChunk``/``center_trim``
primitives) while:

- accumulating only the vocals source, which cuts the overlap-add pass roughly
  4x and reduces peak Metal pool memory
- wrapping the model forward in ``mx.compile``, tracing one graph per input
  shape (all full batches share a shape, so the model compiles once)
"""

from __future__ import annotations

import random
from collections.abc import Callable
from pathlib import Path
from typing import Any

VOCALS_SOURCE = "vocals"

# Compiled forwards keyed by id(model); separators (and their models) live for
# the worker process, so entries are never stale in practice.
_COMPILED_FORWARD: dict[int, Callable[..., Any]] = {}
_WEIGHT_CACHE: dict[tuple[int, str], Any] = {}


def segment_stride(segment_length: int, overlap: float) -> int:
    """Distance between consecutive segment starts for a given overlap."""
    return int((1 - overlap) * segment_length)


def segment_offsets(length: int, stride: int) -> list[int]:
    """Start offsets covering ``length`` samples at the given stride."""
    return list(range(0, length, stride))


def resolve_inner_model(model: Any) -> Any:
    """Unwrap a single-model BagOfModelsMLX; pass plain models through."""
    submodels = getattr(model, "models", None)
    if submodels is None:
        return model
    if len(submodels) != 1:
        raise RuntimeError(
            "Bag-of-models ensembles are not supported by the vocals-only path."
        )
    return submodels[0]


def adapt_channels(wav: Any, channels: int) -> Any:
    """Match decoded audio to the model's expected channel count."""
    import mlx.core as mx

    current = int(wav.shape[0])
    if current == channels:
        return wav
    if channels == 1:
        return mx.mean(wav, axis=0, keepdims=True)
    if current == 1:
        return mx.broadcast_to(wav, (channels, int(wav.shape[1])))
    if current > channels:
        return wav[:channels, :]
    raise ValueError(f"Audio has {current} channels but model expects {channels}.")


def separate_vocals_from_file(separator: Any, input_path: Path) -> Any:
    """Decode a media file and return its vocals stem as an MLX array."""
    import mlx.core as mx

    try:
        import mlx_audio_io
    except ImportError as error:
        raise RuntimeError(
            "Demucs MLX requires the mlx-audio-io package."
        ) from error

    audio, _samplerate = mlx_audio_io.load(
        str(input_path), sr=int(separator.samplerate), dtype="float32"
    )
    wav = adapt_channels(mx.transpose(audio, (1, 0)), int(separator.audio_channels))
    model = resolve_inner_model(separator.model)
    return separate_vocals_array(
        model,
        wav,
        shifts=int(separator.shifts),
        overlap=float(separator.overlap),
        batch_size=int(separator.batch_size),
        seed=separator.seed,
    )


def separate_vocals_array(
    model: Any,
    wav: Any,
    *,
    shifts: int,
    overlap: float,
    batch_size: int,
    seed: int | None = None,
) -> Any:
    """Run the shift/split schedule and return vocals shaped [channels, time]."""
    import mlx.core as mx

    from demucs_mlx.apply_mlx import TensorChunk

    mix = wav[None]
    length = int(mix.shape[-1])

    if shifts:
        rng: Any = random if seed is None else random.Random(int(seed))
        max_shift = int(0.5 * model.samplerate)
        padded = TensorChunk(mix).padded(length + 2 * max_shift)
        padded_chunk = TensorChunk(padded)
        out = None
        for _ in range(int(shifts)):
            offset = rng.randint(0, max_shift)
            shifted = TensorChunk(padded_chunk, offset, length + max_shift - offset)
            shifted_out = _split_vocals(
                model, shifted, overlap=overlap, batch_size=batch_size
            )
            trimmed = shifted_out[..., max_shift - offset :]
            out = trimmed if out is None else out + trimmed
        out = out / shifts
        mx.eval(out)
        return out[0, 0]

    out = _split_vocals(model, TensorChunk(mix), overlap=overlap, batch_size=batch_size)
    mx.eval(out)
    return out[0, 0]


def _compiled_forward(model: Any) -> Callable[..., Any]:
    forward = _COMPILED_FORWARD.get(id(model))
    if forward is None:
        import mlx.core as mx

        forward = mx.compile(lambda x: model(x))
        _COMPILED_FORWARD[id(model)] = forward
    return forward


def _transition_weight(segment_length: int, dtype: Any) -> Any:
    import mlx.core as mx

    cache_key = (segment_length, str(dtype))
    weight = _WEIGHT_CACHE.get(cache_key)
    if weight is None:
        weight = mx.concatenate(
            [
                mx.arange(1, segment_length // 2 + 1),
                mx.arange(segment_length - segment_length // 2, 0, -1),
            ],
            axis=0,
        )
        weight = (weight / mx.max(weight)).astype(dtype)
        _WEIGHT_CACHE[cache_key] = weight
    return weight


def _split_vocals(model: Any, mix_chunk: Any, *, overlap: float, batch_size: int) -> Any:
    import mlx.core as mx

    from demucs_mlx.apply_mlx import TensorChunk
    from demucs_mlx.mlx_utils import center_trim

    forward = _compiled_forward(model)
    vocals_idx = list(model.sources).index(VOCALS_SOURCE)
    batch, channels, length = mix_chunk.shape
    dtype = mix_chunk.tensor.dtype

    out = mx.zeros((batch, 1, channels, length), dtype=dtype)
    sum_weight = mx.zeros((length,), dtype=dtype)

    segment_length = int(model.samplerate * model.segment)
    stride = segment_stride(segment_length, overlap)
    offsets = segment_offsets(length, stride)
    weight = _transition_weight(segment_length, dtype)
    if hasattr(model, "valid_length"):
        std_valid_len = model.valid_length(segment_length)
    else:
        std_valid_len = segment_length

    pending_inputs: list[Any] = []
    pending_offsets: list[int] = []

    # MLX >= 0.31.2 (the locked version) corrupts strided scatter-add slices,
    # so accumulate via read-modify-write slice assignment as upstream does.
    def accumulate(vocals_out: Any, offset: int, chunk_length: int) -> None:
        nonlocal out, sum_weight
        end = offset + chunk_length
        chunk_weight = weight[:chunk_length]
        update = chunk_weight.reshape(1, 1, 1, -1) * vocals_out
        out[:, :, :, offset:end] = out[:, :, :, offset:end] + update
        sum_weight[offset:end] = sum_weight[offset:end] + chunk_weight

    def flush() -> None:
        if not pending_inputs:
            return
        stacked = mx.stack(pending_inputs)
        n_seg, n_batch, n_chan, n_time = stacked.shape
        model_out = forward(stacked.reshape(n_seg * n_batch, n_chan, n_time))
        _, n_src, out_chan, out_time = model_out.shape
        vocals_out = model_out.reshape(n_seg, n_batch, n_src, out_chan, out_time)[
            :, :, vocals_idx : vocals_idx + 1
        ]
        for i, offset in enumerate(pending_offsets):
            accumulate(center_trim(vocals_out[i], segment_length), offset, segment_length)
        # Eval once per flush to bound lazy-graph size, matching upstream.
        mx.eval(out, sum_weight)
        pending_inputs.clear()
        pending_offsets.clear()

    for offset in offsets:
        chunk_length = min(segment_length, length - offset)
        chunk = TensorChunk(mix_chunk, offset, chunk_length)
        if chunk_length == segment_length:
            pending_inputs.append(chunk.padded(std_valid_len))
            pending_offsets.append(offset)
            if len(pending_inputs) >= batch_size:
                flush()
            continue

        flush()
        if hasattr(model, "valid_length"):
            valid_len = model.valid_length(chunk_length)
        else:
            valid_len = chunk_length
        tail_out = forward(chunk.padded(valid_len))
        vocals_out = center_trim(tail_out, chunk_length)[:, vocals_idx : vocals_idx + 1]
        accumulate(vocals_out, offset, chunk_length)
        mx.eval(out, sum_weight)

    flush()

    if bool(mx.any(sum_weight == 0).item()):
        raise ValueError("sum_weight has zeros; check segment and overlap settings")
    return out / sum_weight
