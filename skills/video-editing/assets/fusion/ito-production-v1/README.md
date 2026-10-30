# ITO Production v1 native Fusion presets

These restrained presets are separate from the preserved ITO_V28 compatibility examples. The parent review approved their two-source still previews. Exact installed imports, parameter/connection readbacks, save/reopen and six 30-frame renders passed verification. The Lua installer also passed actual installation and an idempotent rerun, with original presets unchanged. They do not change the finished V28 film.

## Presets

| Preset | Behavior | Starting strength |
|---|---|---|
| HighlightBloom | Glow limited to brighter image content, without an exposure or color-gain node | Threshold 0.70, glow gain 0.12, 6px glow size, 22% blend |
| RGBFringe | Opposing red/blue spatial offsets with unchanged original green/alpha routing and duplicated edge pixels | Normalized horizontal offsets −0.001/+0.001, approximately −1.92/+1.92 px at 1920 px width |
| LumaHalo | Thin glow through a Sobel/luminance mask recomputed from each source frame, without translating the image | 2 px glow size, glow gain 0.10, 25% blend |

The halo follows image edges through its per-frame mask. It performs no object detection or tracking. These are conservative starting values, not a universal match for every shot or reference. RGB output is recombined from actual spatially offset channels; it does not remap green from alpha as the compatibility example does. Both glow nodes use frame clipping. Alpha preservation is established by node routing/disabled alpha processing; H264 proof renders do not contain alpha.

## Install

Keep the three .setting files beside install_ito_production_v1.lua. On macOS run the saved installer from its absolute path:

```sh
"/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript" -l lua "/absolute/path/to/reusable/install_ito_production_v1.lua"
```

It installs into your user Fusion/Macros/ITO_Production_v1 directory. It preflights every source, refuses conflicting installed bytes and verifies readback. Identical reruns are allowed. Existing ITO_V22 and ITO_V28 files remain untouched.

## Import and connect

Use Resolve's TimelineItem.ImportFusionComp with the actual installed .setting path in a new composition or duplicated clip. These are serialized tool-graph snippets, so add the clip's MediaIn and MediaOut boundaries. Internal links are already serialized.

- HighlightBloom: connect MediaIn to ITO_PROD_Bloom.Input; connect Bloom output to MediaOut.
- RGBFringe: connect MediaIn to RedOffset.Input, BlueOffset.Input and RedCopy.Background. Connect BlueCopy output to MediaOut. Each node name carries the ITO_PROD_ prefix.
- LumaHalo: connect MediaIn to Contours.Input and Halo.Input. Connect Halo output to MediaOut. Each node name carries the ITO_PROD_ prefix.

[provenance.json](provenance.json) records exact shipped hashes and a sanitized summary of prior native verification, with hashes of the separately retained evidence. The earlier [ITO V28 compatibility examples](../ito-v28/README.md) are not recommended production defaults. This package does not include the source footage, native project or proof renders.
