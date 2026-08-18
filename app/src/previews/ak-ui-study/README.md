# ak-ui 视觉研究

隔离预览，不进生产入口，也不进 `app/package.json`。

```bash
cd app && npm run dev
# http://localhost:1420/ak-ui-study.html
# http://localhost:1420/ak-ui-study.html?m=ctf
# http://localhost:1420/ak-ui-study.html?m=coding
# http://localhost:1420/ak-ui-study.html?m=settings
# 加 &theme=light 看日间
```

样式钉在 `ak-ui.css` / `ak-ui-tokens.css`，来源见 `SOURCE.txt`（`@yunyoujun/ak-ui@0.2.1`）。

采用计划见 [ADOPTION.md](./ADOPTION.md)。截图在 `shots/`。
