# 开发与联调

## 结构

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle.patch` + `dsh.client`（platform `web`、激活顺序、`./client` 导出） |
| `cordis.patch.yml` | bundle 的插入补丁；`name` 必须与包名一致 |
| `index.js` | Host 半边：空实现，行为全在浏览器侧 |
| `client.js` | 浏览器半边：`window.__ModuleLoader__.load({ id, factory })`，注册到 `conversation.composer.dock` |
| `locale/{en,zh}.json` | 插件管理页显示的标题与描述 |
| `icon.svg` | 插件图标 |
| `index.json` | 插件市场 format 1 索引 |

改包名时要同步三处：`package.json` 的 `name`、`cordis.patch.yml` 的 `name`、`client.js` 的 `id`（以及 `NS`）。

## 在当前 profile 里联调

1. 如果装过旧包 `@local/dsh-token-speed`，先卸载。两个 bundle 同时注册 `conversation.composer.dock` 会出现重复胶囊。
2. **Plugins → Add plugin** 填本目录的绝对路径安装，得到 `link:` 依赖；之后改文件即生效。
3. 或者用 CLI：

   ```sh
   dsh plugin --profile desktop add "$(pwd)"
   ```

## 生效方式

- `client.js`：客户端 bundle 的 revision 按文件 mtime 生成，刷新页面即可。
- `index.js` / `cordis.patch.yml`：在 Plugins 页关闭再打开该插件；必要时重启应用。

## 校验

```sh
npm run check
npm run pack:check
```

`pack:check` 会列出 npm/git 安装实际打包的文件；`files` 漏掉运行时会装上但没反应。

## 发布

1. 修改 `package.json` 的 `version`。
2. 确认 `package.json`、`cordis.patch.yml`、`client.js` 三处名字一致。
3. 打 tag 并推送：

   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   GitHub Actions 会校验 tag 与 `package.json` 一致，然后发布 npm 并创建 GitHub Release；需要在仓库 secrets 里配置 `NPM_TOKEN`。
4. 发布后更新 `index.json` 中对应版本的 `version` 与 `publishTimestamp`（Unix 秒）。
5. 市场索引走 Git 源时，`source.commit` 必须是完整的 40 位 commit sha。
