# ITO V28 Fusion compatibility examples

These are preserved technical compatibility examples, **not recommended production defaults**. Native import and render checks establish that the graphs execute; visual review found blown highlights in Bloom, a strong green channel remap in RGB, and a translated full-frame border in Halo. Tune and visually review any derived look before production use.

This versioned bundle preserves the original ITO_V22 installation. It contains three serialized Fusion tool graphs and a Lua installer. A sanitized summary and hashes of the separately retained native evidence are recorded in [provenance.json](provenance.json); installation alone is not import/render proof.

## Install on macOS

Keep the three .setting files beside install_ito_v28.lua. Run the installer from its absolute path with Resolve's bundled interpreter:

```sh
"/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript" -l lua "/absolute/path/to/reusable/install_ito_v28.lua"
```

The installer writes to your user Fusion/Macros/ITO_V28 folder, verifies exact bytes and is safe to rerun when those bytes match. It refuses a conflicting existing file and never replaces ITO_V22. The prior native verification run passed both the initial execution and an idempotent second execution using the bundled Lua runtime. See [provenance.json](provenance.json).

## Import and wire

The verified host API route is TimelineItem.ImportFusionComp with the actual .setting path. These files are tool-graph snippets, not complete footage compositions or one-click tracked effects. Connect the clip's MediaIn output to the first image tool, then the last image tool to MediaOut. Preserve the serialized internal links.

| Setting | External image chain |
|---|---|
| FlashEtherealBloom | MediaIn → ITO_V28_FlashGain → FlashBloom → FlashColor → MediaOut |
| RGBDisplacement | MediaIn → ITO_V28_RGBBase → RGBShift → RGBSmear → MediaOut |
| SubjectHalo | MediaIn → ITO_V28_SubjectGlow → SubjectFrame → MediaOut; SubjectRect connects to SubjectGlow's EffectMask |

Names after the first node in the table also carry the ITO_V28_ prefix. Use a new composition or duplicate clip when trying these effects, so the existing composition stays available.

## Scope and correction

The original RGB file used the unavailable ChannelBooleans registry identifier and an invalid image input name. V28 uses the live registered ChannelBoolean with Background and Foreground connected to RGBBase. It preserves the original selectors 4/3/2. The resulting effect is channel remapping, slight scale and directional smear; its historical filename does not establish separate-channel spatial displacement.

SubjectHalo is a static rectangular effect mask plus a position adjustment. It performs no subject detection or tracking. Bloom and Halo otherwise retain their original numeric parameters. Original settings and failure evidence remain preserved.

These native tests are separate from the finished V28 film, whose source-derived treatments use rendered media. They do not modify that film or its portable archive.
