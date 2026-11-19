# 第一次从零搭一台：复演记录

这份文件记录**真实**走过的过程：谁走的、花了多久、卡在哪、当时的原话。它不是教程——
教程是 README。A5 会在这里正式写一次完整的复演；在那之前只有下面这一条。

## 2026-11-19 · 安装与清单（A2 验收，作者自走）

**起跑线**：新目录、`git clone` 一份、没有 `node_modules`、没有 `~/.bot-reborn`、没有模型文件。
Node 24.13.1 已装（按约定算环境，不算流程）。机器上另一个大脑正占用 8787。

**只允许这三条命令**：

```bash
npm install
npm run setup
npm start
```

**结果**：三条都通过。`npm install` 6 秒（170 个包）。`npm run setup` 拉了 6 MB 模型并构建，
然后如实报告 `port 8787 is already in use` 并给出 `PORT=<another>` 的用法 —— 这是符合预期的，
因为起跑线上已经有一个大脑在跑。`PORT=8899 npm start` 之后：

- `http://localhost:8899/` → 200，admin 页面
- `http://localhost:8899/sim/` → 200，工作台能开
- Projects → Audio + screen → Shopping list → 9 行、总计 $33.00–83.00，屏带「还没人在真板上
  点亮过」的提示；打印预览一页纸

**卡点**：0 处停顿超过 2 分钟。没有需要跳出 README 才能继续的地方。

**记下来的小毛病**（没有当场修）：

- `npm run setup` 会连带打印 Vite 的「chunk 超过 500 kB」警告，第一次看会以为出错了。
- 自己机器上大脑已经在跑时，`npm run setup` 的失败观感比实际严重（端口那条其实不影响已经
  跑着的那个）。
