from pathlib import Path

import numpy as np
import pytest

import al_iyaal_worker.demucs_mlx as demucs_mlx
from al_iyaal_worker import demucs_mlx_apply

mx = pytest.importorskip("mlx.core")


def test_should_compute_segment_stride_from_overlap() -> None:
    assert demucs_mlx_apply.segment_stride(100, 0.25) == 75
    assert demucs_mlx_apply.segment_stride(100, 0.10) == 90
    assert demucs_mlx_apply.segment_stride(100, 0.0) == 100


def test_should_cover_full_length_with_segment_offsets() -> None:
    assert demucs_mlx_apply.segment_offsets(250, 90) == [0, 90, 180]
    assert demucs_mlx_apply.segment_offsets(90, 90) == [0]


def test_should_unwrap_single_model_bags() -> None:
    class Inner:
        pass

    class Bag:
        models = [Inner()]

    inner = demucs_mlx_apply.resolve_inner_model(Bag())
    assert isinstance(inner, Inner)

    plain = Inner()
    assert demucs_mlx_apply.resolve_inner_model(plain) is plain


def test_should_reject_multi_model_bags() -> None:
    class Bag:
        models = [object(), object()]

    with pytest.raises(RuntimeError, match="Bag-of-models"):
        demucs_mlx_apply.resolve_inner_model(Bag())


def test_should_adapt_channel_counts() -> None:
    stereo = mx.ones((2, 8))
    mono = mx.ones((1, 8))

    assert demucs_mlx_apply.adapt_channels(stereo, 2) is stereo
    assert demucs_mlx_apply.adapt_channels(stereo, 1).shape == (1, 8)
    assert demucs_mlx_apply.adapt_channels(mono, 2).shape == (2, 8)
    with pytest.raises(ValueError, match="channels"):
        demucs_mlx_apply.adapt_channels(mx.ones((3, 8)), 4)


class IdentityModel:
    """Fake 4-source model that echoes the mix into every stem.

    Mirrors htdemucs's use_train_segment behavior: valid_length always
    returns the training segment length.
    """

    sources = ["drums", "bass", "other", "vocals"]
    samplerate = 100
    segment = 0.5

    def valid_length(self, length: int) -> int:
        return int(self.samplerate * self.segment)

    def __call__(self, x):
        return mx.broadcast_to(x[:, None], (x.shape[0], 4, x.shape[1], x.shape[2]))


@pytest.mark.parametrize("shifts", [0, 1, 2])
def test_should_reconstruct_vocals_through_overlap_add(shifts: int) -> None:
    rng = np.random.default_rng(7)
    wav_np = rng.standard_normal((2, 237)).astype(np.float32)
    wav = mx.array(wav_np)

    vocals = demucs_mlx_apply.separate_vocals_array(
        IdentityModel(), wav, shifts=shifts, overlap=0.10, batch_size=3, seed=42
    )

    assert vocals.shape == (2, 237)
    np.testing.assert_allclose(np.asarray(vocals), wav_np, atol=1e-5)


def test_should_report_monotonic_progress_for_processed_segments() -> None:
    progress: list[float] = []

    demucs_mlx_apply.separate_vocals_array(
        IdentityModel(),
        mx.ones((2, 237)),
        shifts=0,
        overlap=0.10,
        batch_size=3,
        seed=42,
        on_progress=progress.append,
    )

    assert len(progress) >= 2
    assert progress == sorted(progress)
    assert progress[-1] == 1.0


def test_should_disable_fused_metal_kernels_by_default(monkeypatch) -> None:
    metal_kernels = pytest.importorskip("demucs_mlx.metal_kernels")
    monkeypatch.delenv("AIYAAL_DEMUCS_MLX_FUSED_KERNELS", raising=False)
    monkeypatch.setattr(metal_kernels, "HAS_METAL", True)

    demucs_mlx.disable_fused_metal_kernels()

    assert metal_kernels.HAS_METAL is False


def test_should_keep_fused_metal_kernels_when_opted_in(monkeypatch) -> None:
    metal_kernels = pytest.importorskip("demucs_mlx.metal_kernels")
    monkeypatch.setenv("AIYAAL_DEMUCS_MLX_FUSED_KERNELS", "1")
    monkeypatch.setattr(metal_kernels, "HAS_METAL", True)

    demucs_mlx.disable_fused_metal_kernels()

    assert metal_kernels.HAS_METAL is True


def test_should_use_vocals_only_apply_path_by_default(tmp_path: Path) -> None:
    engine = demucs_mlx.DemucsMlxSeparator(tmp_path / "models")
    assert engine._load_apply_fn() is demucs_mlx_apply.separate_vocals_from_file
