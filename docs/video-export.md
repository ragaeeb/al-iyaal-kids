# Video export

Cut export uses one FFmpeg process for all selected ranges. An `ffconcat`
manifest supplies each range as an `inpoint`/`outpoint` pair, while
`concatdec_select` removes packets outside those exact boundaries before the
selected content is encoded. This avoids intermediate slice files, repeated
encoder startup, and a separate concat pass.

## Presets

- `Fast high quality (Apple HEVC)` is the default. It uses the macOS
  VideoToolbox HEVC hardware encoder at quality 75, disables its
  speed-over-quality preference, enables spatial adaptive quantization, and
  refuses a silent software fallback. Audio is encoded as AAC at 192 kbps.
- `Smallest file (slow HEVC)` keeps the prior software x265 path at CRF 28 and
  the `slow` preset. It trades substantially more CPU time for a smaller file.
- `Compatibility (slow H.264)` uses software x264 at CRF 20 and the `veryslow`
  preset when playback compatibility matters more than export speed.

The hardware preset is still a lossy video encode, just like the prior default.
It is configured to retain more measured visual quality than that default; it
optimizes export time rather than file size. Choose `Smallest file` when storage
is the primary constraint.

## Local benchmark

Measured on an Apple M4 Max with FFmpeg 8.1.2 using a synthetic 12-second,
3840x2160, 30 fps H.264 source. The export retained two ranges totalling seven
seconds. VMAF was measured against the selected source frames after both were
scaled to 1920x1080 with Lanczos.

| Worker path | Wall time | User CPU time | Output size | Mean VMAF |
| --- | ---: | ---: | ---: | ---: |
| Previous x265 slice-and-concat default | 17.94 s | 178.64 s | 15.3 MB | 97.206 |
| Single-pass Apple VideoToolbox default | 2.19 s | 4.17 s | 39.5 MB | 98.436 |

On this fixture, the new default was 8.2 times faster and used 97.7% less user
CPU time while improving the measured VMAF score. This is one synthetic local
benchmark, so absolute results and output sizes will vary with source content.

## References

- [Apple VideoToolbox quality property](https://developer.apple.com/documentation/videotoolbox/kvtcompressionpropertykey_quality)
- [FFmpeg concat demuxer documentation](https://ffmpeg.org/ffmpeg-formats.html#concat-1)
- [FFmpeg VideoToolbox encoder implementation](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/videotoolboxenc.c)
