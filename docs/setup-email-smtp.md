# 配置登录邮件（Resend + Supabase 自定义 SMTP）

## 为什么要做这个

card-writer 用邮箱 magic-link 登录。Supabase **内置**的发信服务只当测试用，
默认限制约 **每小时 2 封**（整个项目共享）。连点几次「发送登录链接」就会报
`email rate limit exceeded`。

配一个自己的 SMTP（这里用 Resend，最省事）后，限制由你自己定，邮件也更快、
更不容易进垃圾箱。整个过程约 10 分钟，一次配好长期有效。

---

## 一、注册 Resend 并拿到 API Key

1. 打开 <https://resend.com>，用邮箱注册（免费额度：每天 100 封 / 每月 3000 封，个人用绰绰有余）。
2. 登录后左侧 **API Keys** → **Create API Key**，权限选 **Sending access** 即可。
3. 复制生成的 key（形如 `re_xxxxxxxx`），**只显示一次**，先存好。

### 关于发件域名（决定「发件人」能写什么）

- **想快速试**：可以直接用 Resend 的测试发件地址 `onboarding@resend.dev`，
  不用配域名，但只能发给**你自己注册 Resend 用的那个邮箱**，适合先跑通登录。
- **正式用**：左侧 **Domains** → **Add Domain** 添加你自己的域名（比如
  `card-writer.pages.dev` 用不了，需要你拥有的域名），按提示到域名 DNS 里加
  Resend 给的 **SPF / DKIM** 记录，验证通过后就能用
  `noreply@你的域名` 当发件人，任何人都收得到。

> 没有自己的域名也没关系：先用 `onboarding@resend.dev` 把登录跑通，
> 以后有域名了再回来换。

---

## 二、在 Supabase 后台填 SMTP

进 Supabase 项目 → **Authentication → Emails → SMTP Settings** →
打开 **Enable Custom SMTP**，按下面填（这是 Resend 的固定值）：

| 字段 | 填什么 |
| --- | --- |
| **Host** | `smtp.resend.com` |
| **Port** | `465`（或 `587`） |
| **Username** | `resend` |
| **Password** | 第一步复制的 API Key（`re_xxxx`） |
| **Sender email** | `onboarding@resend.dev`（测试）或 `noreply@你的域名`（正式） |
| **Sender name** | 随便，比如 `Card Writer` |

点 **Save**。

---

## 三、把发信频率上限调高

Supabase 项目 → **Authentication → Rate Limits** → 找到
**Rate limit for sending emails**，从默认值调高（比如 `100` / 小时）。
配了自定义 SMTP 后这个数才真正生效，不再被内置服务卡着。

---

## 四、确认登录跳转地址（否则点了链接被拒）

Supabase 项目 → **Authentication → URL Configuration**：

- **Site URL** 和 **Redirect URLs** 里要**包含 app 实际打开的地址**，
  否则邮件里的登录链接点开会报 redirect 被拒。
- 至少加上：
  - `http://localhost:5173`（本地开发）
  - `https://card-writer.pages.dev`（线上部署）

> 代码里 magic link 的回跳地址用的是 `window.location.origin`（见
> `src/state/authStore.ts` 的 `emailRedirectTo`），所以你从哪个域名打开 app，
> 就要把那个域名加进这里。

---

## 五、验证

1. 打开 app → 输邮箱 → 点「发送登录链接」。
2. 去邮箱收信（Resend 发的，通常几秒到），点链接跳回 app → 登录成功。
3. 登录后本地已写的书会自动上云；session 长期有效，不用每次都登。

## 出问题时怎么查

- **还是 `email rate limit exceeded`**：SMTP 没保存成功，或第三步的上限没调；
  回去确认 Enable Custom SMTP 是开着的、密码是 API Key 本身。
- **收不到邮件**：用测试发件地址 `onboarding@resend.dev` 时，只能发给你注册
  Resend 的那个邮箱；换别的收件邮箱要先在 Resend 验证自己的域名。也看下垃圾箱。
- **点链接报 redirect 错误**：回第四步，把你打开 app 的域名加进 Redirect URLs。
- **想临时不登录**：app 上点「先本地用（不登录）」，照样能写，书存在本地，
  以后登录会自动同步上云。
