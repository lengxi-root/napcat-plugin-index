# napcat-plugin-index

NapCat 插件索引仓库

## 🚀 插件提交方式

### 方式一：自动提交（推荐）

使用 [napcat-plugin-template](https://github.com/NapNeko/napcat-plugin-template) 模板开发插件，内置 CI 会在你发布 Release 时**自动向本仓库提交 PR**，无需手动操作。

**流程：**

```
插件仓库 push tag → CI 构建 + 发布 Release → 自动提交 PR 到本仓库 → CI 自动审核 → 维护者合并
```

**配置步骤：**

1. 使用模板创建插件仓库
2. 编辑 `package.json`，填写插件信息和 `napcat` 字段：
   ```json
   {
     "name": "napcat-plugin-your-name",
     "plugin": "你的插件显示名",
     "version": "1.0.0",
     "description": "插件描述",
     "author": "你的名字",
     "napcat": {
       "tags": ["工具"],
       "minVersion": "4.14.0",
       "homepage": "https://github.com/username/napcat-plugin-your-name"
     }
   }
   ```
3. 在插件仓库 Settings > Secrets 中配置 `INDEX_PAT`（一个有 `repo` 权限的 Personal Access Token，用于向本仓库提交 PR）
4. 正常开发，推送 `v*` tag 即可自动发布并更新索引

### 方式二：手动提交 PR

1. **Fork 本仓库** 并在自己的分支上修改 `plugins.v4.json`
2. **一个 PR 只做一件事**（新增/更新/删除一个插件）
3. 提交后 CI 会自动校验，通过后等待维护者合并

---

## 📋 插件信息字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 插件唯一标识，格式：`napcat-plugin-xxx`（小写字母、数字、连字符） |
| `name` | string | ✅ | 插件显示名称 |
| `version` | string | ✅ | 插件版本号（semver 格式） |
| `description` | string | ✅ | 插件简短描述 |
| `author` | string | ✅ | 作者名称 |
| `homepage` | string | ✅ | 插件主页/仓库地址 |
| `downloadUrl` | string | ✅ | 插件下载地址（必须是可直接下载的 .zip 链接） |
| `tags` | string[] | ✅ | 插件标签，用于分类 |
| `minVersion` | string | ✅ | 支持的最低 NapCat 版本 |

### 可用标签

`官方` `工具` `娱乐` `AI` `群管` `管理` `自动化` `语音` `表情` `撤回` `游戏` `音乐` `图片` `视频` `搜索` `翻译` `天气` `签到` `抽奖` `其他`

### 插件提交模板

```json
{
  "id": "napcat-plugin-example",
  "name": "示例插件",
  "version": "1.0.0",
  "description": "这是一个示例插件的描述",
  "author": "YourName",
  "homepage": "https://github.com/username/napcat-plugin-example",
  "downloadUrl": "https://github.com/username/napcat-plugin-example/releases/download/v1.0.0/napcat-plugin-example.zip",
  "tags": ["工具"],
  "minVersion": "4.14.0"
}
```

---

## 🤖 CI 自动化

本仓库配置了以下自动化流程：

| 工作流 | 触发条件 | 功能 |
|--------|----------|------|
| **PR 自动审核** | PR 修改 `plugins.v4.json` | 校验 JSON 格式、字段完整性、ID 唯一性、版本号格式、下载链接可达性，自动评论校验结果并打标签 |
| **链接定时巡检** | 每天 UTC 04:00 | 检查所有插件的下载链接是否仍然有效，失效时自动创建 Issue 通知 |

---

## ⚠️ 注意事项

1. 插件 `id` 必须全局唯一，且符合 `napcat-plugin-xxx` 命名规范
2. `downloadUrl` 必须是可直接下载的 zip 文件链接
3. 版本号需符合 semver 格式（如 `1.0.0`、`1.2.3-beta.1`）
4. 提交前请在本地测试插件是否可正常下载和安装
5. 推荐使用 [napcat-plugin-template](https://github.com/NapNeko/napcat-plugin-template) 模板开发，享受自动化提交体验

---

## 📄 License

MIT License
