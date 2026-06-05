---
name: ui-to-vue
description: Use when the user has UI screenshots or design exports that need batch conversion into Vue 3 components, especially with Vant, Element Plus, or Ant Design Vue.
origin: community
---

# UI To Vue

Batch-convert UI design screenshots into Vue 3 Composition API component code.

## When to Use

- The user provides a directory of design screenshots or design-export images.
- The target application is Vue 3.
- The user wants a first pass of page components, shared components, and router wiring.
- The user specifies Vant, Element Plus, or Ant Design Vue as the component library.

## When Not to Use

- The user has only one screenshot and wants a bespoke component.
- The target project is not Vue.
- The design requires detailed interaction logic, data flow, or accessibility review.
- The screenshots contain private customer data that cannot be sent to an external model API.

## Inputs

Use an input directory that groups screenshots by module and page state:

```text
screenshots/
|-- HomePage/
|   |-- List/
|   |   |-- HomePage-List-Default@3x.png
|   |   `-- cut-images/
|   |-- cut-images/
|   `-- HomePage-Default@3x.png
`-- cut-images/
```

Supported cut-image directory names include `assets`, `icons`, `sprites`, `cut`, `images`, and `cut-images`.

## Conversion Model

- Page grouping: combine related screenshots into one page component when they represent list, detail, form, loading, or empty states.
- UI library mapping: map native visual elements to Vant, Element Plus, or Ant Design Vue components where practical.
- Cut-image priority: prefer page-level assets, then module-level assets, then global shared assets.
- Component extraction: extract repeated UI regions into shared components when they appear more than once.

## CLI Usage

Run the converter with `npx` so the documented command works without relying on a global binary:

```bash
export DASHSCOPE_API_KEY=your_key
npx ui-to-vue-converter@1.0.2 --input ./screenshots --ui vant --output ./src
```

For desktop UI libraries:

```bash
npx ui-to-vue-converter@1.0.2 --input ./designs --ui element-plus --output ./src
npx ui-to-vue-converter@1.0.2 --input ./designs --ui antd-vue --output ./src
```

If the package is installed globally, the `ui-to-vue` binary can be used directly:

```bash
npm install -g ui-to-vue-converter@1.0.2
ui-to-vue --input ./screenshots --ui vant --output ./src
```

## Options

| Option | Description | Default |
| --- | --- | --- |
| `--input` | Design image directory | `./screenshots` |
| `--ui` | UI library: `vant`, `element-plus`, or `antd-vue` | `vant` |
| `--output` | Output directory | `./src` |
| `--config` | Config file path | `./.ui-to-vue.config.json` |

## API Key Handling

The converter can read DashScope credentials from a config file or from the environment. Prefer an environment variable in repositories:

```bash
export DASHSCOPE_API_KEY=your_key
```

If a local config file is required, keep it out of version control:

```json
{
  "apiKey": "your_dashscope_key",
  "input": "./designs",
  "ui": "vant",
  "output": "./src"
}
```

```gitignore
.ui-to-vue.config.json
```

## Security and Privacy

- Treat design screenshots as source material that may be sent to an external model API.
- Do not run this flow on private customer designs without permission.
- Pin the converter version in repeatable workflows instead of using `@latest`.
- Review generated Vue code before committing it.
- Do not commit `.ui-to-vue.config.json`, API keys, generated secrets, or customer screenshots.

## Output Review Checklist

- [ ] Page components were generated under `views/` or the chosen output directory.
- [ ] Repeated UI regions were extracted into `components/` only when reuse is clear.
- [ ] Router output is compatible with the target project's router style.
- [ ] Generated components use the requested UI library consistently.
- [ ] Generated CSS units match the design baseline.
- [ ] The code passes the project's formatter, linter, type checker, and build.
- [ ] Placeholder copy, mock data, and generated assets were reviewed before commit.

## Troubleshooting

| Issue | Check |
| --- | --- |
| `401` or authentication error | Confirm `DASHSCOPE_API_KEY` is set in the shell running the command. |
| `command not found: ui-to-vue` | Use the `npx ui-to-vue-converter@1.0.2` form or install the package globally. |
| Cut images are ignored | Confirm the asset directory name is supported and nested under the matching page or module. |
| Components ignore the requested UI library | Re-run with an explicit `--ui` value and inspect the generated imports. |
| Generated layout dimensions look wrong | Confirm the screenshot export width matches the target library baseline. |

## References

- npm package: `ui-to-vue-converter`
