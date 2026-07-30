(function (root) {
  "use strict";

  var documentRef = root.document;
  var STORAGE_KEY = "dradar-language-v1";
  var ATTRIBUTES = ["title", "aria-label", "placeholder", "alt", "data-tip"];
  var currentLanguage = "zh";
  var textRecords = new WeakMap();
  var attributeRecords = new WeakMap();
  var translatedTextNodes = new Set();
  var translatedElements = new Set();

  var EXACT = {
    "分布式雷达 Codex站": "Distributed Radar · Codex",
    "分布式雷达 Claude Code站": "Distributed Radar · Claude Code",
    "DeepSWE 真实开源任务 × GPT-5.6 全系与 GPT-5.5 high/xhigh 共 19 个推理档位：一张表看清全部众测进度。服务端独立判分，志愿者用自己的订阅额度贡献算力。":
      "Live results across 19 reasoning tiers of GPT-5.6 and GPT-5.5 on real open-source DeepSWE tasks. Independent server-side grading, powered by compute donated from volunteers' own subscriptions.",
    "分布式雷达": "Distributed Radar ·",
    "站": "",
    "站点导航": "Site navigation",
    "雷达天梯": "Leaderboard",
    "如何参与": "How to Join",
    "这是什么": "What Is This?",
    "加入雷达群": "Join the Community",
    "开源": " Open Source",
    "全网首个": "The world's first",
    "大模型众测雷达": " crowdsourced LLM benchmark radar",
    "导出雷达报告 →": "Export Radar Report →",
    "← 返回主站": "← Back to main site",
    "← 返回 Codex 雷达": "← Back to Codex Radar",
    "← 返回 Claude Code 雷达": "← Back to Claude Code Radar",
    "返回主站": "Back to main site",
    "雷达刷新提速公告": "Faster Radar Refresh",
    "模型智力": "Model Intelligence",
    "📡 模型智力": "📡 Model Intelligence",
    "IQ 统计模式": "IQ calculation mode",
    "实时监控": "Live",
    "近期表现": "Recent",
    "IQ 曲线时间范围": "IQ chart time range",
    "按编程语言筛选模型智力与题目": "Filter model IQ and tasks by programming language",
    "语言": "Language",
    "加载中……": "Loading…",
    "加载大表中……": "Loading benchmark matrix…",
    "小提示：": "Tip: ",
    "知道了 ×": "Got it ×",
    "关闭档位曲线提示": "Dismiss tier chart tip",
    "⚡ 智力效率": "⚡ Intelligence Efficiency",
    "平均值 · 与上方 IQ 口径同步 · 每 60 秒刷新":
      "Averages · Uses the IQ mode above · Refreshes every 60 seconds",
    "正在读取价格、耗时与 IQ……": "Loading price, runtime, and IQ…",
    "回到最新播报，停留3秒后重新滚动": "Jump to the latest update and resume scrolling after 3 seconds",
    "回到最新播报，停留 3 秒": "Jump to the latest update and pause for 3 seconds",
    "站长推荐": "Editor's Picks",
    "实时": "Live",
    "⚠️ 降智预警": "⚠️ Performance Alerts",
    "我的 Codex 订阅类型": "My Codex plan",
    "🎯 自动推荐": "🎯 Auto-pick",
    "🎯 换一批": "🎯 Pick another set",
    "📍 只看我的": "📍 My cells only",
    "全部状态": "All statuses",
    "可认领": "Available",
    "已认领": "Claimed",
    "解题中": "Running",
    "判分中": "Grading",
    "冷却中": "Cooldown",
    "按状态筛选": "Filter by status",
    "全部模型": "All models",
    "按模型筛选": "Filter by model",
    "全部档位": "All tiers",
    "按推理档位筛选": "Filter by reasoning tier",
    "更多筛选": "More filters",
    "认领者": "Claimed by",
    "昵称": "Nickname",
    "最近结果": "Latest result",
    "全部结果": "All results",
    "最近通过": "Latest passed",
    "最近未通过": "Latest failed",
    "无最近结果": "No recent result",
    "周额度百分比": "Weekly quota percentage",
    "最小": "Min",
    "最大": "Max",
    "周额度百分比最小值": "Minimum weekly quota percentage",
    "周额度百分比最大值": "Maximum weekly quota percentage",
    "积分倍率": "Point multiplier",
    "积分倍率最小值": "Minimum point multiplier",
    "积分倍率最大值": "Maximum point multiplier",
    "重置筛选": "Reset filters",
    "未设置筛选，显示全部格子": "No filters applied · Showing all cells",
    "清除全部": "Clear all",
    "👈 左右滑动看全部 19 档——任务名已为你钉在左侧":
      "👈 Swipe to see all 19 tiers — task names stay pinned on the left",
    "复制安装检查提示词": "Copy setup prompt",
    "安装检查提示词已复制 ✓": "Setup prompt copied ✓",
    "复制环境检查提示词": "Copy environment-check prompt",
    "环境检查提示词已复制 ✓": "Environment-check prompt copied ✓",
    "月榜": "Monthly",
    "总榜": "All-time",
    "连接分布式雷达": "Connect with Distributed Radar",
    "雷达交流群": "Radar WeChat Group",
    "官方公众号": "Official WeChat Account",
    "交流跑题经验，参与雷达开发建设与领奖":
      "Share benchmark-running experience, help build Radar, and join community rewards",
    "官方唯一公众号 · 获取每日 AI 黄历":
      "The official account · Get the daily AI almanac",
    "分布式雷达交流群微信二维码": "Distributed Radar WeChat group QR code",
    "分布式雷达唯一官方公众号二维码": "Official Distributed Radar WeChat account QR code",
    "数据每分钟刷新": "Data refreshes every minute",
    "基线更新于": "Baseline updated",
    "重选": "Pick again",
    "清空": "Clear",
    "认领": "Claim",
    "关闭": "Close",
    "取消": "Cancel",
    "确定": "Confirm",
    "知道了": "Got it",
    "首次参与？先检查运行环境": "First time here? Check your environment first",
    "复制提示词不会占用格子，也不会启动正式跑题。":
      "Copying the prompt does not claim a cell or start a benchmark run.",
    "暂不认领": "Not now",
    "环境已准备好，继续认领": "Environment ready · Continue",
    "全部": "All",
    "全部编程语言": "All programming languages",
    "未知": "Unknown",
    "正在擦车": "Wrapping up",
    "准备中": "Preparing",
    "正在蹬": "Pedaling",
    "GitHub 身份": "GitHub identity",
    "雷达身份": "Radar identity",
    "切换 GitHub": "Switch GitHub",
    "退出": "Log out",
    "用 GitHub 登录": "Sign in with GitHub",
    "换账号登录": "Use another account",
    "当前显示 GitHub 用户名": "Showing GitHub username",
    "点击修改雷达昵称": "Edit Radar nickname",
    "当前使用雷达身份，点击切换为 GitHub 身份":
      "Using Radar identity · Click to switch to GitHub identity",
    "当前使用 GitHub 身份，点击切换为雷达身份":
      "Using GitHub identity · Click to switch to Radar identity",
    "切换公开展示使用的身份": "Switch the identity shown publicly",
    "前往 GitHub 官方页面添加或切换账号": "Open GitHub's official page to add or switch accounts",
    "待实测": "Awaiting data",
    "认领格子点亮实时值": "Claim cells to add live results",
    "暂无有效样本": "No valid samples yet",
    "有真实运行数据后自动绘制": "This chart appears automatically once real runs arrive",
    "越靠左上越高效": "Best ↖",
    "全屏": "Full screen",
    "↙ 退出": "↙ Exit full screen",
    "横轴在此截断": "The x-axis is compressed here",
    "推理强度形状图例": "Reasoning-effort shape legend",
    "综合成本指数说明": "Combined cost index explanation",
    "综合成本 × 智力": "Cost × IQ",
    "综合成本（对数）": "Combined cost (log)",
    "综合成本指数（最高 = 100 · 对数轴）": "Combined cost index (max = 100 · log scale)",
    "时间成本 × 智力": "Time × IQ",
    "平均耗时（分钟 · 对数轴）": "Average runtime (minutes · log scale)",
    "费用成本 × 智力": "$ Cost × IQ",
    "平均价格（USD · 对数轴）": "Average cost (USD · log scale)",
    "模型 / 档位": "Model / Tier",
    "耗时": "Runtime",
    "费用": "Cost",
    "日常开发": "Daily Development",
    "难题攻坚": "Hard Problems",
    "后台自动化": "Background Automation",
    "跑龙虾类任务": "Long-running Agent Tasks",
    "暂无符合条件的档位": "No tier currently matches",
    "推荐规则：": "Selection rule: ",
    "示意图 · 数据积累中": "Preview · Collecting data",
    "曲线：": "Charts: ",
    "正在蹬": "Active",
    "待开跑": "Waiting",
    "跑题中": "Running",
    "总蹬速": "Network burn rate",
    "刀": "USD",
    "亿词元": "×100M tokens",
    "最近": "Recent",
    "绿=通过": "Green = passed",
    "红=未通过": "Red = failed",
    "刚刚": "just now",
    "微蹬了": "ran",
    "小蹬了": "ran",
    "中蹬了": "ran",
    "大蹬了": "ran",
    "猛蹬了": "ran",
    "匿名志愿者": "Anonymous volunteer",
    "未知模型": "Unknown model",
    "估价 $": "estimated $",
    "实耗 $": "actual $",
    "区分度": "Discrimination",
    "未开放": "Unavailable",
    "专属格": "Exclusive cell",
    "已认领，待开跑": "Claimed · Waiting to start",
    "正在解题": "Running",
    "已提交，排队判分中": "Submitted · Waiting for grading",
    "在跑": "running",
    "不参与24小时名次比较": "Not included in the 24-hour rank comparison",
    "暂无可比较的历史名次": "No comparable historical rank",
    "近24小时排名持平": "Rank unchanged over 24 hours",
    "只看在蹬": "Active riders only",
    "趋势": "Trend",
    "雷达蹬友": "Radar Rider",
    "积分": "Points",
    "贡献 tokens": "Tokens contributed",
    "折算": "Value",
    "已判分": "Graded",
    "本月提交": "Monthly submissions",
    "总提交": "Total submissions",
    "当前没有在蹬的蹬友。": "No riders are active right now.",
    "虚位以待——第一批志愿者的名字会刻在这里。":
      "The leaderboard is waiting for its first contributors.",
    "当前没有达到预警阈值的模型档位":
      "No model tier currently meets the alert threshold",
    "区分度排序 ↓": "Sorted by discrimination ↓",
    "历史通过率热力图": "Historical Pass-rate Heatmap",
    "致谢 · 雷达天梯 TOP 20": "Thank You · Radar Leaderboard Top 20",
    "每一次蹬踏，都让雷达测试得更准。致敬每一位贡献算力的蹬友 🫡":
      "Every run makes the Radar more accurate. Thank you to everyone donating compute 🫡",
    "分布式雷达实时报告 · 图片生成时刻以页首为准":
      "Distributed Radar live report · See the header for generation time",
    "实时报告": "Live Report",
    "分布式雷达数据全景": "Distributed Radar Snapshot",
    "正在读取实时数据…": "Loading live data…",
    "生成高清图片中": "Generating high-resolution image",
    "分布式雷达实时报告预览": "Distributed Radar live report preview",
    "↻ 重新生成": "↻ Regenerate",
    "↓ 下载图片": "↓ Download image",
    "⧉ 复制图片": "⧉ Copy image",
    "正在绘制 2400 × 4840 高清图片…": "Rendering a 2400 × 4840 high-resolution image…",
    "实时报告已生成 · PNG 高清原图": "Live report ready · Full-resolution PNG",
    "✓ 已复制": "✓ Copied",
    "图片已复制到剪贴板，可以直接粘贴": "Image copied to clipboard · Ready to paste",
    "数据读取失败": "Could not load radar data",
    "天梯读取失败": "Could not load leaderboard data",
    "趋势读取失败": "Could not load trend data",
    "图片编码失败": "Could not encode the image",
    "生成失败，请稍后重试": "Generation failed · Please try again",
    "当前浏览器不支持复制图片，请使用下载图片":
      "This browser cannot copy images · Please download the image instead",
    "复制失败，请改用下载图片": "Copy failed · Please download the image instead",
    "本地文件模式无法读取实时数据，请通过本地网站地址打开主页":
      "Live data is unavailable in file mode · Open the page through a local web server",
    "全站累计蹬掉": "Total compute burned",
    "全站累计贡献": "Total tokens contributed",
    "全站志愿者": "Total volunteers",
    "GPT-5.6 全模型": "All GPT-5.6 Models",
    "人": "volunteers",
    "格": "cells",
    "题": "tasks",
    "⛶ 全屏": "⛶ Full screen",
    "1 · 用 GitHub 登录": "1 · Sign in with GitHub",
    "2 · 选好你的订阅档位": "2 · Select your plan",
    "3 · 首次使用先准备环境": "3 · Prepare your environment",
    "4 · 选格子认领": "4 · Select and claim cells",
    "5 · 粘给 codex 跑起来": "5 · Paste into Codex and run",
    "6 · 回来看表": "6 · Return to the matrix",
    "5 / 10 / 20 个": "5 / 10 / 20 cells",
    "100% = 150 分": "100% = 150 IQ",
    "0% = 0 分": "0% = 0 IQ",
    "。比如 86% 就是 129 分。": ". For example, 86% becomes an IQ of 129.",
    "格子越久没有有效实测，加成越高，最高":
      "The longer a cell goes without a valid run, the larger its bonus, up to",
    "20 并发 / 一次 20 题": "20 concurrent / 20 per batch",
    "10 并发 / 一次 10 题": "10 concurrent / 10 per batch",
    "5 并发 / 一次 5 题": "5 concurrent / 5 per batch",
    "独家定制3D打印雷达奖杯": "custom 3D-printed Radar trophies",
    "近24小时排名变化": "Rank change over the past 24 hours",
    "只显示当前有自行车的蹬友": "Show only contributors who are currently active",
    "真实平均耗时和实际用量费用": "Actual average runtime and usage cost",
    "。": ".",
    "，": ", ",
    "；": "; ",
    "：": ": "
  };

  Object.assign(EXACT, {
    "什么是分布式雷达 · Codex 众测站":
      "What Is Distributed Radar? · Codex Crowdsourced Benchmark",
    "3 分钟看懂分布式雷达：社区志愿者用自己的 Codex 订阅实测 GPT-5.6 的真实编码能力，服务端独立判分，降智无处逃。":
      "Distributed Radar in three minutes: volunteers use their own Codex subscriptions to measure GPT-5.6 on real coding tasks, with independent server-side grading.",
    "📡 分布式雷达 ·": "📡 Distributed Radar ·",
    "Codex 众测站": "Codex Crowdsourced Benchmark",
    "← 返回众测大表": "← Back to the benchmark matrix",
    "你的 GPT": "Is your GPT",
    "又双叒": "getting worse ",
    "降智": "again",
    "了?": "?",
    "别猜了,也别吵了——": "Stop guessing and arguing—",
    "咱们直接测给全网看。": "let's benchmark it for everyone to see.",
    "人人蹬一脚 · 降智无处逃": "One run each · Performance drops have nowhere to hide",
    "去认领格子 →": "Claim a cell →",
    "四步上手": "Get started in four steps",
    "个格子": "cells",
    "112 道真实开源编程题": "112 real open-source coding tasks",
    "19 个模型档位": "19 model tiers",
    "每个格子 = 一个模型在这道题、这个推理档位的":
      "Each cell shows a model's ",
    "最近实测通过率": "latest measured pass rate",
    ",由社区志愿者用自己的 Codex 订阅跑出来,实时点亮。":
      " on that task at that reasoning tier, generated live by volunteers using their own Codex subscriptions.",
    "官方跑分是静态成绩单,雷达测的是":
      "Official benchmarks are static report cards. Radar measures the model ",
    "此刻": "right now",
    "的模型;还把上一代": " and compares it in the same arena with the previous generation, ",
    "GPT-5.5 拉进同场对照": "GPT-5.5",
    ",降没降智一眼见分晓。": ", so performance changes are visible at a glance.",
    "Sol · 6 档": "Sol · 6 tiers",
    "Terra · 6 档": "Terra · 6 tiers",
    "Luna · 5 档": "Luna · 5 tiers",
    "5.5 high/xhigh · 上代对照": "5.5 high/xhigh · Previous-gen baseline",
    "社区志愿者": "Community volunteers",
    "服务端独立判分": "Independent server-side grades",
    "百亿级": "10B+",
    "累计贡献 tokens": "Tokens contributed",
    "怎么参与": "How to Join",
    "四步上车,一条命令都不用敲": "Four steps · No commands to type",
    "GitHub 登录众测站": "Sign in with GitHub",
    "只用来确认身份、发访问令牌,": "Used only to verify your identity and issue an access token. ",
    "不碰你的 OpenAI 账号": "Your OpenAI account is never accessed",
    "在大表挑格子认领": "Choose cells from the matrix",
    "每格标着透明价签(约占你 7 天额度的 %),":
      "Every cell has a transparent estimate (its approximate share of your 7-day quota). ",
    "量力认领": "Claim what fits your budget",
    ",最多 10 个;懒得挑就点\"🎯 系统推荐 10 格\"。":
      ", up to 10 at a time; or select “🎯 Auto-pick 10 cells.”",
    "复制命令,粘给你的 Codex": "Copy the prompt and paste it into Codex",
    "它自己配环境、自己跑题、自己上传。":
      "It configures the environment, runs the tasks, and uploads the results. ",
    "你去干别的,它跑完叫你。": "You can do something else while it works.",
    "回来看格子点亮": "Come back to see your cells light up",
    "你跑过的格子上有你的头像,名字登上":
      "Your avatar appears on every cell you run, and your name joins the ",
    "值不值": "Is It Worth It?",
    "烧的是额度,攒的是江湖地位": "Spend quota · Build reputation",
    "你付出": "You contribute",
    "自己订阅里的一点额度——": "A little quota from your own subscription—",
    "价签全透明": "every estimate is transparent",
    ",跑之前就知道大概花多少,绝不盲烧":
      ", so you know the approximate cost before a run starts.",
    "你得到": "You receive",
    "积分 = 烧掉的额度,": "Points reflect the quota used, and ",
    "过不过都给分": "both passes and failures earn points",
    "——啃硬骨头不亏,失败也是有效数据":
      "—hard problems are never wasted, because failures are valid data too.",
    "天梯排名 + GitHub 头像亮相,总榜积分":
      "Leaderboard rank and GitHub visibility, with all-time points that ",
    "永久累计、永不缩水": "accumulate permanently",
    "第一手知道模型什么时候降智——": "Be the first to know when model performance changes—",
    "你就是雷达本达": "you are part of the Radar",
    "🏆 每月结算:月榜": "🏆 Monthly awards: the ",
    "冠亚季军": "top three",
    "各得一座": " each receive a ",
    "独家定制 3D 打印雷达奖杯": "custom 3D-printed Radar trophy",
    ",月初积分重赛,人人有机会。":
      ". Monthly points reset at the start of each month, so everyone gets another chance.",
    "凭什么信": "Why Trust It?",
    "数据真实,是这座雷达的命": "Trustworthy data is the Radar's foundation",
    "成绩会不会有人刷?": "Can someone fake a score?",
    "刷不了。你只上传补丁,": "No. You upload only a patch; ",
    "服务器在干净环境里重新跑测试判分":
      "the server reruns the tests and grades it in a clean environment",
    "——谁自报的结果都不算数,包括我们自己。":
      ". Self-reported results never count—including ours.",
    "我的账号安全吗?": "Is my account safe?",
    "订阅凭据": "Your subscription credentials ",
    "全程留在你自己机器上": "stay on your own machine at all times",
    ",从不经过我们服务器;上传前自动脱敏、扫密钥,带密钥的补丁直接拒收。":
      " and never pass through our servers. Uploads are scrubbed and scanned for secrets; patches containing a secret are rejected.",
    "跑一半挂了额度白烧?": "What if a run stops halfway?",
    "中断可": "Interrupted runs support ",
    "断点续跑": "resume from checkpoint",
    ";上传失败自动补传;平台自身故障导致的损失":
      "; failed uploads retry automatically; losses caused by platform failures receive ",
    "照价补积分": "matching point compensation",
    "有人作弊怎么办?": "What happens when someone cheats?",
    "全程轨迹审计(联网搜索直接作废)、异常提交先隔离复核——":
      "Full trajectory audits invalidate prohibited web searches, and suspicious submissions are isolated for review—",
    "误伤有出口,作弊无收益": "false positives can be restored; cheating brings no reward",
    "现在上车": "Join Now",
    "下一格,等你来点亮": "The next cell is waiting for you",
    "进入众测大表 →": "Open the benchmark matrix →",
    "你需要:": "You need: ",
    "Codex 订阅": "a Codex subscription",
    "(Plus 就够) ·": " (Plus is enough) · ",
    "开源客户端": "Open-source client: ",
    "社区群:主站": "Community: scan the QR code on ",
    "扫码,反馈直达开发者": " to reach the developers directly",
    "分布式雷达 · Codex 众测站 · powered by codexradar":
      "Distributed Radar · Codex Crowdsourced Benchmark · powered by codexradar"
  });

  var PHRASES = [
    ["随着雷达测试志愿者持续增加，总算力显著提升，这是社区共同参与带来的好消息。雷达现已将格子刷新周期从 ",
      "As more volunteers join the Radar, our shared compute capacity keeps growing. Cell refreshes have now been shortened from "],
    ["，超过 12 小时的冷却格子会自动开放。更多格子、更快复测，让雷达数据更实时。",
      ". Cells cooling down for more than 12 hours reopen automatically. More available cells and faster retests keep the Radar current."],
    ["18 小时缩短至 12 小时", "18 hours to 12 hours"],
    ["👆 点一个档位查看单档 IQ 和曲线；继续点其他档位，可叠加多条曲线对比。再点一次即可取消。",
      "Select a tier to see its IQ and trend. Select more tiers to compare them; select one again to remove it."],
    ["每格取最新1次有效结果，适合快速发现模型降质或恢复。",
      "Uses the latest valid result in each cell to spot changes quickly."],
    ["每格取最近3次有效结果，适合观察稳定能力和整体趋势。",
      "Uses the three most recent valid results in each cell to show stable performance and broader trends."],
    ["表里每个格子的百分比 = 跑这道题大约占用你所选档位 7 天额度的比例。同一道题对 Plus 可能是 6%，对 20x Pro 只有 0.3%——选对档位，价签才是你的真实成本。",
      "Each cell shows the estimated share of your selected plan's 7-day quota needed for that task. The same task might use 6% on Plus but only 0.3% on 20x Pro—choose your plan for a realistic estimate."],
    ["自动从测得少的格子中推荐一批，数量按你的月榜档位决定——再点一次换一批",
      "Automatically picks under-tested cells; batch size follows your monthly rank tier. Click again for another set."],
    ["高亮你认领/在跑/刚判完还没重开的格子，再点一次收起筛选、只看这些",
      "Highlights cells you claimed, are running, or recently finished and have not reopened. Click again to show only those cells."],
    ["右上角登录，只用来确认身份、发一个访问令牌。", "Sign in at the top right to verify your identity and receive an access token. "],
    ["不会碰你的 OpenAI 账号", "Your OpenAI account is never accessed"],
    ["——订阅凭据全程留在你自己机器上，从不经过我们服务器。",
      "—your subscription credentials always stay on your machine and never pass through our servers."],
    ["在表格上方的“我的 Codex 订阅类型”选择你的订阅档（Plus / 5x Pro / 20x Pro）——格子里的百分比是",
      "Choose your plan (Plus / 5x Pro / 20x Pro) under “My Codex plan” above the matrix. Each percentage estimates "],
    ["这道题大约占你选中档位 7 天额度的比例",
      "the share of your selected plan's 7-day quota used by that task"],
    ["，同一道题对 Plus 可能是 6%，对 20x Pro 只有 0.3%。选对档位，看到的才是你的真实成本。",
      ". The same task might use 6% on Plus but only 0.3% on 20x Pro. Select the right plan to see your real cost."],
    ["第一次来，建议先让 Codex 安装并检查环境，", "On your first visit, let Codex install and check the environment. "],
    ["这一步不会占用任务格子，也不会启动正式跑题",
      "This does not claim a cell or start a benchmark run"],
    ["。全部检查通过后再选题，认领后的 10 分钟都能真正留给启动任务。",
      ". Choose tasks after every check passes, so the full 10-minute claim window remains available to start them."],
    ["点表里可认领的格子勾选，单次最多 ", "Select available cells in the matrix—up to "],
    ["（按月榜排名解锁），底部按“认领”；懒得挑就点“🎯 自动推荐”。10 分钟没开跑自动放回。",
      " per batch, unlocked by monthly rank—then press “Claim” at the bottom. Or use “🎯 Auto-pick.” Cells return automatically if a run does not start within 10 minutes."],
    ["粘贴进你的 codex，它会自动配好环境、装好 dradar，把认领的题全部跑完——",
      "Paste the prompt into Codex. It configures the environment, installs dradar, and runs every claimed task—"],
    ["不用你敲一条命令", "no commands to type"],
    ["高级玩法：", "Advanced: "],
    ["直接问 Codex“dradar CLI 能做什么”，或让它“自动认领一批并跑完”“按本机配置并发跑已认领任务”“查看进度并补跑失败项”。不用背命令，描述目标就行。",
      "Ask Codex what the dradar CLI can do, or tell it to auto-claim and run a batch, run claimed tasks concurrently for this machine, check progress, or retry failures. Describe the goal—there are no commands to memorize."],
    ["你跑过的格子会点亮，名字也登上雷达天梯。发现问题或想改进？欢迎到 ",
      "The cells you run light up, and your name appears on the leaderboard. Found an issue or have an improvement? Visit the "],
    ["DRadar 开源仓库 ↗", "open-source DRadar repository ↗"],
    [" 提交 Issue 或 PR，一起把雷达做得更好。",
      " to open an issue or pull request and help improve the Radar."],
    ["测试的是什么题库？", "Which benchmark tasks are tested?"],
    ["目前开放的是 ", "The current benchmark uses "],
    [" 真实开源仓库任务，具体数量以雷达表实时显示为准。计划扩展到 DeepSWE 之外的",
      " real-world tasks from open-source repositories; the live matrix shows the current task count. We plan to expand beyond DeepSWE to "],
    ["公版 benchmark", "public benchmarks"],
    ["，以及社区自建的", " and "],
    ["个性化评测题库", "community-built custom evaluations"],
    ["百分比得分和 Codex 雷达的 IQ 分数怎么换算？",
      "How does the percentage score convert to Codex Radar IQ?"],
    ["。这里的通过率百分比乘以 1.5，就是 ", ". Multiply the pass-rate percentage by 1.5 to get the IQ score shown on "],
    ["Codex 雷达", "Codex Radar"],
    ["上的 IQ 分数——满分对齐：", ". The scales align at the endpoints: "],
    [" 分。比如 86% 就是 129 分。", ". For example, 86% becomes an IQ of 129."],
    ["会支持其他 coding agent 和模型吗？", "Will other coding agents and models be supported?"],
    ["会。", "Yes."],
    ["会烧我多少额度？", "How much quota will this use?"],
    ["额度是你自己的，dradar ", "The quota is yours. dradar "],
    ["不替你管、也不读取普通志愿者账号的余量",
      "does not manage or read the remaining quota of regular volunteers"],
    ["。Codex 已取消 5 小时滚动限制，现在只有", ". Codex no longer has a rolling 5-hour limit; the only constraint is the "],
    ["7 天额度", "7-day quota"],
    ["一道约束，表里的价签全部按周额度换算——大多数题只占你周额度的百分之几，比 5h 时代宽裕约 6 倍。价签按你的订阅档估算（用上方档位切换），认领时量力而行即可。万一跑到一半撞上额度墙，任务会直接失败、格子自动放回给别人——不会白占着，也不会偷偷替你等额度刷新。价签由历史实测 + 志愿者数据每 15 分钟自动校准；档位总容量由站方超级账号在真实任务前后通过 Codex app-server 测量，累计实耗至少 $50 才会生成候选值，并且必须经过人工确认才会更新。",
      ". Every estimate is expressed as a share of weekly quota. Most tasks use only a few percent—about six times more headroom than the 5-hour era. Estimates follow the plan selected above. If a run hits the quota limit, it fails and the cell returns for others; it never occupies a cell while secretly waiting for a reset. Estimates recalibrate every 15 minutes from historical runs and volunteer data. Total plan capacity is measured with a station-owned super account before and after real tasks; a candidate update requires at least $50 of measured usage and manual approval."],
    ["积分怎么算？", "How are points calculated?"],
    ["格子百分比只用于估算你的额度消耗，", "Cell percentages estimate quota usage and "],
    ["不影响贡献积分", "do not affect contribution points"],
    ["。格子越久没有有效实测，加成越高，最高 ", ". The longer a cell goes without a valid run, the larger its bonus, up to "],
    ["。认领时锁定价签和加成；提交时加成更高，则按更高值结算。",
      ". The estimate and multiplier are locked when claimed; if the multiplier is higher at submission, the higher value applies."],
    ["服务端完成有效判分就计分，模型通过或未通过都一样；异常或待复核记录暂不计分。单次实耗只用于展示和校准价签，不直接影响积分。",
      "Points are awarded after valid server-side grading, whether the model passes or fails. Anomalous or pending-review records do not count until cleared. Measured usage is shown and used to calibrate estimates, but does not directly change points."],
    ["天梯排名怎样影响并发和领题数？", "How does leaderboard rank affect concurrency and batch size?"],
    ["每天认领数量", "Daily claims are "],
    ["不限", "unlimited"],
    ["。并发上限和单次领题数按", ". Concurrency and per-batch claim limits follow your "],
    ["当前月榜", "current monthly rank"],
    ["排名分三档：第 1–10 名为 ", ": ranks 1–10 get "],
    ["，第 11–50 名为 ", "; ranks 11–50 get "],
    ["，第 51 名以后及尚未上榜的新手为 ", "; rank 51+ and unranked newcomers get "],
    ["。跑完腾出位子就能继续领；排名变化后自动按新档位生效。",
      ". Finish runs to free slots and claim more; rank changes update these limits automatically."],
    ["自行车和蹬踏时间怎么算？", "How are bikes and active time calculated?"],
    ["开始真实跑题就会显示自行车；同时有几路绑定题目且心跳有效的 runner，就依次显示几辆自行车和对应路数，约 15 秒刷新。最后一次有效跑题或提交后的 ",
      "A bike appears when a real run starts. Each runner with a bound task and a valid heartbeat adds a bike and worker count, refreshed about every 15 seconds. Bikes remain visible for "],
    ["内继续显示，期间接着跑会续在同一轮，超过 10 分钟才下掉并在下次重新计轮。",
      " after the last valid run or submission; continuing within that window extends the same session. After 10 minutes, the bike leaves and the next run starts a new session. "],
    ["蹬踏时间", "Active time"],
    ["只算实际跑题时间，排队、换题、断线和留榜宽限不计时，并发重叠只算一次。",
      " counts only real task runtime. Queuing, switching tasks, disconnects, and leaderboard grace periods are excluded; overlapping concurrent runs count once."],
    ["可以并行跑题吗？", "Can tasks run concurrently?"],
    ["可以", "Yes"],
    ["——并发上限与当前月榜档位一致：第 1–10 名为 20，第 11–50 名为 10，第 51 名以后及尚未上榜的新手为 5。这是账号可同时运行的上限，不代表机器一定适合开满；请根据自己的 CPU、内存和额度量力而行，并发太多会让单题变慢。",
      "—concurrency follows the current monthly rank tier: 20 for ranks 1–10, 10 for ranks 11–50, and 5 for rank 51+ and unranked newcomers. This is an account limit, not a guarantee that every machine should use it; choose a level that fits your CPU, memory, and quota. More concurrency can slow individual tasks."],
    ["数据安全吗？", "Is my data safe?"],
    ["每道题都在独立、一次性的 Docker 容器里跑和判分，测完即销毁，跟别的题、别人的环境互不串扰。上传前后两道敏感信息扫描，带密钥的补丁直接拒收；凭据文件从不上传。公开的只有昵称、积分和判分干净的轨迹。",
      "Every task runs and is graded in its own disposable Docker container. Containers are destroyed afterward and isolated from other tasks and users. Sensitive-data scans run before and after upload; patches containing secrets are rejected, and credential files are never uploaded. Only nicknames, points, and clean graded trajectories are public."],
    ["分数怎么保证真实？", "How are scores kept trustworthy?"],
    ["客户端自报的结果一概不算数：每个补丁都在服务端的干净容器里重跑验证器打分。另有租约时间差、轨迹审计等多层检测，可疑提交",
      "Client-reported results never count. Every patch is rerun and graded by a verifier in a clean server-side container. Lease timing, trajectory audits, and other checks flag suspicious submissions, which are "],
    ["先冻结", "frozen first"],
    ["——积分暂扣、不上榜、不计晋升，人工复核后：误伤的原数奉还（分一分不少），坐实的清零封号。",
      "—points are withheld, leaderboard placement and rank benefits pause, and a human review follows. False positives receive every point back; confirmed abuse results in zeroed points and a ban."],
    ["每一次蹬踏，都让雷达测试得更准。致敬每一位贡献算力的蹬友 🫡",
      "Every run makes the Radar more accurate. Thank you to everyone donating compute 🫡"],
    ["环境安装和初始化可能需要几分钟。建议先让 Codex 完成安装并通过 ",
      "Installation and initialization can take a few minutes. Let Codex finish setup and pass "],
    ["，再回来认领，避免任务因 10 分钟内未启动被自动释放。",
      ", then return to claim tasks so they are not released for failing to start within 10 minutes."],
    ["请先交给 Codex 执行；检查完成后回来点“环境已准备好，继续认领”。",
      "Give this to Codex first. When the checks finish, return and select “Environment ready · Continue.”"],
    ["浏览器没能复制，请允许剪贴板权限后重试。",
      "The browser could not copy this. Allow clipboard access and try again."],
    ["浏览器没能复制提示词，请允许剪贴板权限后重试。",
      "The browser could not copy the prompt. Allow clipboard access and try again."],
    ["请先点右上角“用 GitHub 登录”。登录后再点这里复制安装检查提示词，不需要先认领任务。",
      "Select “Sign in with GitHub” at the top right first. After signing in, copy the setup prompt here before claiming any tasks."],
    ["这个功能要先用 GitHub 登录，才知道哪些格子是你的。",
      "Sign in with GitHub first so Radar can identify your cells."],
    ["暂时无法同步你的格子和头像，请刷新后重试。",
      "Could not sync your cells and avatar. Refresh and try again."],
    ["你手上现在没有在跑/待重开的格子——先去认领几个吧。",
      "You have no running or pending-reopen cells. Claim a few first."],
    ["认领任务需要先用 GitHub 登录确认身份（只用来确认你是谁 + 给你发访问令牌，不会碰你的订阅账号）。现在去 GitHub 登录？",
      "Claiming requires GitHub sign-in to verify your identity and issue an access token. Your subscription account is never accessed. Sign in now?"],
    ["去 GitHub 登录", "Sign in with GitHub"],
    ["这个题目配置已经变了，刷新一下页面再试",
      "This task configuration changed. Refresh the page and try again."],
    ["这格暂时进不去（满员或冷却中）",
      "This cell is temporarily unavailable because it is full or cooling down."],
    ["请先用 GitHub 登录", "Please sign in with GitHub first"],
    ["登录已失效，请重新用 GitHub 登录", "Your session expired. Sign in with GitHub again."],
    ["这个账号已被封禁", "This account has been suspended"],
    ["这个站还没开启 GitHub 登录", "GitHub sign-in is not enabled on this site"],
    ["这个 GitHub 账号已经绑定过另一个账号了",
      "This GitHub account is already linked to another account"],
    ["生成账号昵称时出了点问题，请重试", "Could not generate an account nickname. Try again."],
    ["昵称太长：最多 14 个英文字符或 7 个中文字符",
      "Nickname is too long: use at most 14 Latin characters or 7 Chinese characters"],
    ["GitHub 没有返回可用的身份信息，请重试",
      "GitHub did not return a usable identity. Try again."],
    ["GitHub 授权码无效或已过期，请重新登录",
      "The GitHub authorization code is invalid or expired. Sign in again."],
    ["GitHub 授权失败，请重试", "GitHub authorization failed. Try again."],
    ["连接 GitHub 时出了点问题，请重试", "Could not connect to GitHub. Try again."],
    ["你已达到当前月榜档位的并发上限——先把手上的跑完或放回（没开跑的 10 分钟后自动放回），再认领新的",
      "You have reached your monthly-rank concurrency limit. Finish or release current tasks before claiming more; tasks that have not started return automatically after 10 minutes."],
    ["认领需要先用 GitHub 登录", "Sign in with GitHub before claiming"],
    ["未知错误", "Unknown error"],
    ["操作没成功，请刷新后重试", "The action failed. Refresh and try again."],
    ["GitHub 登录暂不可用：", "GitHub sign-in is temporarily unavailable: "],
    ["GitHub 登录校验失败，请重新登录", "GitHub sign-in verification failed. Sign in again."],
    ["GitHub 登录失败：", "GitHub sign-in failed: "],
    ["设置失败，稍后再试", "Could not save this setting. Try again later."],
    ["改名失败，稍后再试", "Could not change the nickname. Try again later."],
    ["改名失败：", "Could not change the nickname: "],
    ["新昵称（最多 14 个英文字符或 7 个中文字符，可混合）",
      "New nickname (up to 14 Latin characters or 7 Chinese characters; mixed scripts are supported)"],
    ["中文/字母/数字/- _ . 都可以", "Chinese characters, letters, numbers, -, _, and . are allowed"],
    ["⚠ 请勿在昵称中打广告或填写推广信息", "⚠ Do not use nicknames for ads or promotions"],
    ["一次最多选 ", "You can select at most "],
    [" 个格子——先把这些认领跑掉，跑完再来选。",
      " cells at a time. Claim and run these, then select more."],
    ["已开始运行的任务不会被释放。", "Tasks that have already started will not be released."],
    ["你手上尚未开始运行的上一批会自动换成这一批；",
      "Your previous batch that has not started will be replaced by this one; "],
    ["网络请求失败，请稍后再试", "Network request failed. Try again later."],
    ["服务端推荐了最缺人的替代格子，一键补上？",
      "The server found under-tested replacement cells. Claim them with one click?"],
    ["这些没领到（原因见每条）：", "These cells could not be claimed (see each reason):"],
    ["点击复制，然后", "Select copy, then "],
    ["粘贴给 Codex", "paste into Codex"],
    ["。它会检查环境并开始运行这些题，", ". It will check the environment and start these tasks. "],
    ["10 分钟内没检测到真正开始跑，会自动放回待认领。",
      "If no real run starts within 10 minutes, the cells return automatically."],
    ["复制给 Codex", "Copy for Codex"],
    ["已复制 ✓", "Copied ✓"],
    ["暂时没拿到可选的推荐格子，稍等片刻再试（表格可能刚更新）。",
      "No recommended cells are available right now. Wait a moment and try again; the matrix may have just refreshed."],
    ["推荐服务暂时不可用：", "Recommendations are temporarily unavailable: "],
    ["你已经开始运行的任务占满了当前月榜档位的名额；请先跑完一些，再领取新推荐。未开始的任务不会占用这次换批名额。",
      "Running tasks already fill your monthly-rank concurrency slots. Finish some before requesting new recommendations. Tasks that have not started do not count against this replacement batch."],
    ["当前还没有实测数据", "No measured data yet"],
    ["最近1小时全站已提交任务的真实消耗总额，仅计 Pier 实报或按实际 token 计算的费用",
      "Actual network-wide cost of tasks submitted in the past hour, using Pier-reported cost or cost calculated from real token usage"],
    ["全体志愿者累计烧掉的额度，按当前价签估算成美元",
      "Cumulative quota used by all volunteers, estimated in USD at current prices"],
    ["全体志愿者累计贡献的模型词元", "Cumulative model tokens contributed by all volunteers"],
    ["开启：按照题目综合区分度从大到小排序；关闭：按任务 ID 字母排序",
      "On: sort tasks by overall discrimination. Off: sort alphabetically by task ID."],
    ["区分度数据暂不可用，当前按任务 ID 字母排序",
      "Discrimination data is unavailable; tasks are sorted alphabetically by ID."],
    ["取消倍率排序，恢复原来的题目顺序", "Clear multiplier sorting and restore the original task order"],
    ["这个站的大表还没开启（", "The benchmark matrix is not available on this site ("],
    ["）——参与方式见下方，数据稍后自动重试。",
      "). See participation instructions below; the data will retry automatically."],
    ["分布式雷达 · powered by ", "Distributed Radar · powered by "],
    [" · 数据每分钟刷新 ·", " · Data refreshes every minute ·"],
    [" · 基线更新于 ", " · Baseline updated "],
    [" · 返回主站", " · Back to main site"]
  ];

  var PATTERNS = [
    [/^已选 (\d+)\/(\d+) 个(?: · )?(.*)$/i, function (m, selected, max, rest) {
      return "Selected " + selected + "/" + max + (rest ? " · " + translateText(rest) : "");
    }],
    [/^认领这 (\d+) 个$/, "Claim these $1"],
    [/^认领这 (\d+) 个格子？$/, "Claim these $1 cells?"],
    [/^已认领 (\d+) 个格子$/, "Claimed $1 cells"],
    [/^换成这 (\d+) 个认领$/, "Claim these $1 replacements"],
    [/^请在 (\d+) 分钟内执行，否则任务将会被释放。$/,
      "Start within $1 minutes or the tasks will be released."],
    [/^重选中…$/, "Picking…"],
    [/^预计 ~(\d+) 分钟$/, "Est. ~$1 min"],
    [/^，约占你 (.+) 的 7 天额度 (.+)$/, " · About $2 of your $1 7-day quota"],
    [/^跑一次 ≈ (.+) 周额度 · 约 (.+) 分钟(?:（估价）)?$/,
      "One run ≈ $1 of weekly quota · about $2 min"],
    [/^最近一次判分实得 (.+) 积分$/, "Latest graded run earned $1 points"],
    [/^累计通过 (\d+)\/(\d+) 次$/, "$1/$2 passed overall"],
    [
      /^冷却中，(.+)后重开抢首跑$/,
      function (_match, duration) {
        return (
          "Cooling down · Reopens " +
          (/内$/.test(duration)
            ? translateText(duration)
            : "in " + translateText(duration))
        );
      },
    ],
    [/^点击选中(?:（另有 (\d+) 人在测）)?$/, function (m, others) {
      return others ? "Select this cell · " + others + " others are running it" : "Select this cell";
    }],
    [/^(\d+) 份提交判分中$/, "$1 submissions are being graded"],
    [/^(\d+) 在跑$/, "$1 running"],
    [/^(\d+)分钟$/, "$1 min"],
    [/^<1分钟$/, "<1 min"],
    [/^(\d+)小时$/, "$1 hr"],
    [/^(\d+)小时(\d+)分钟$/, "$1h $2m"],
    [/^(\d+)时(\d+)分钟$/, "$1h $2m"],
    [/^(\d+)时$/, "$1h"],
    [/^(\d+)分钟内$/, "within $1 min"],
    [/^(\d+)小时后重开$/, "Reopens in $1 hr"],
    [/^(\d+)分钟后重开$/, "Reopens in $1 min"],
    [/^1分钟内后重开$/, "Reopens within 1 min"],
    [/^\$(.+)\/小时$/, "$$$1/hr"],
    [/^实耗 \$(.+)$/, "actual $$$1"],
    [/^估价 \$(.+)$/, "estimated $$$1"],
    [/^(\d+)车正在冲线$/, "$1 workers finishing"],
    [/^(\d+)车正在蹬$/, "$1 workers running"],
    [/^1车独行$/, "1 worker"],
    [/^(\d+)车并行$/, "$1 workers"],
    [/^已交(\d+)题$/, "$1 submitted"],
    [/^已判(\d+)题$/, "$1 graded"],
    [/^\+([\d.]+)积分$/, "+$1 points"],
    [/^仅看推荐 (\d+) 格$/, "$1 recommended cells only"],
    [/^最近 (\d+) 次$/, "Latest $1 runs"],
    [/^最近 (\d+) 小时$/, "Past $1 hours"],
    [/^最近 (\d+) 小时 IQ 趋势，悬停查看时间和分数$/,
      "IQ trend over the past $1 hours · Hover for time and score"],
    [/^最近 (\d+) 小时多档位 IQ 对比，悬停查看时间和分数$/,
      "Multi-tier IQ comparison over the past $1 hours · Hover for time and score"],
    [/^(\d+) 分钟前$/, "$1 min ago"],
    [/^(\d+) 小时前$/, "$1 hr ago"],
    [/^(\d+) 天前$/, "$1 days ago"],
    [/^(\d+) 分钟$/, "$1 min"],
    [/^(\d+) 次$/, "$1 runs"],
    [/^(\d+) 次费用、(\d+) 次耗时$/, "$1 cost samples · $2 runtime samples"],
    [/^(\d+) 次实报$/, "$1 reported samples"],
    [/^(\d+) 次按实际 token 用量计算$/, "$1 calculated from actual token usage"],
    [/^(\d+) 次历史不完整用量已排除$/, "$1 incomplete historical samples excluded"],
    [/^(\d+) 次缺原始用量$/, "$1 missing raw usage"],
    [/^(\d+) 人$/, "$1 volunteers"],
    [/^(\d+) 题$/, "$1 tasks"],
    [/^(\d+)题 × (\d+)档$/, "$1 tasks × $2 tiers"],
    [/^(\d+)档$/, "$1 tiers"],
    [/^([\d.]+) 亿$/, function (m, value) {
      return (Number(value) / 10).toLocaleString("en-US", {
        maximumFractionDigits: 1
      }) + "B";
    }],
    [/^(\d+) 路正在蹬，(\d+) 路正在冲线$/, "$1 running · $2 finishing"],
    [/^1 路正在蹬$/, "1 worker running"],
    [/^1 路正在冲线$/, "1 worker finishing"],
    [/^(\d+) 路正在蹬$/, "$1 workers running"],
    [/^(\d+) 路正在冲线$/, "$1 workers finishing"],
    [/^(\d+) 路并发正在蹬$/, "$1 concurrent workers running"],
    [/^24小时上升(\d+)名$/, "Up $1 places in 24 hours"],
    [/^24小时下降(\d+)名$/, "Down $1 places in 24 hours"],
    [/^展开全部 (\d+) 名（还有 (\d+) 位）$/, "Show all $1 contributors ($2 more)"],
    [/^收起，只看前 (\d+) 名及在线蹬友$/, "Collapse to the top $1 and active riders"],
    [/^按 (.+) (.+) 的倍率从高到低排序$/, "Sort by $1 $2 multiplier, highest first"],
    [/^最近跑过这格，(通过 ✓|未通过 ✗)$/, function (m, result) {
      return "Most recent runner " + (result.indexOf("通过") === 0 ? "passed ✓" : "failed ✗");
    }],
    [/^(\d+)月(\d+)日 0点（北京时间）结算，距结算 (\d+) 天 · 月初积分重赛，总榜永久累计$/,
      "Settles Jul $2 at 00:00 Beijing time · $3 days remaining · Monthly points reset; all-time points remain"],
    [/^🏆 月榜冠亚季军得独家定制3D打印雷达奖杯 · (.*)$/,
      "🏆 Monthly top 3 win custom 3D-printed Radar trophies · $1"],
    [/^· (\d+)月(\d+)日 0点（北京时间）结算，距结算 (\d+) 天 · 月初积分重赛，总榜永久累计$/,
      function (m, month, day, days) {
        var monthName = new Intl.DateTimeFormat("en-US", {month: "short"})
          .format(new Date(2000, Number(month) - 1, 1));
        return "· Settles " + monthName + " " + day +
          " at 00:00 Beijing time · " + days +
          " days remaining · Monthly points reset; all-time points remain";
      }],
    [/^([\d.]+)积分$/, "$1 points"]
  ];

  var TOKENS = [
    ["实时监控（每格最新1次）", "Live (latest valid result per cell)"],
    ["近期表现（每格最近3次）", "Recent (latest 3 valid results per cell)"],
    ["最新有效格子", "latest valid cells"],
    ["最近3次实测", "latest 3 measured runs"],
    ["点击加入", "Click to add"],
    ["的对比曲线，再点一次取消", " to the comparison chart; click again to remove"],
    ["当前 IQ", "current IQ"],
    ["当前还没有实测数据", "no measured data yet"],
    ["真实平均耗时", "actual average runtime"],
    ["实际用量均价", "average actual usage cost"],
    ["完整会话", "complete sessions · "],
    ["暂无有效运行耗时", "no valid runtime samples"],
    ["暂无完整会话运行费用", "no complete-session cost samples"],
    ["暂无有效运行费用", "no valid cost samples"],
    ["次有效运行", " valid runs"],
    ["次按实际 token 用量计算", " calculated from actual token usage"],
    ["次历史不完整用量已排除", " incomplete historical usage samples excluded"],
    ["次缺原始用量", " missing raw-usage samples"],
    ["次实报", " reported samples"],
    ["次费用", " cost samples"],
    ["次耗时", " runtime samples"],
    ["综合成本指数", "combined cost index"],
    ["综合成本 × 智力", "Cost × IQ"],
    ["时间成本 × 智力", "Time × IQ"],
    ["费用成本 × 智力", "$ Cost × IQ"],
    ["越靠左上越高效", "Best ↖"],
    ["🧑‍💻　日常开发", "🧑‍💻　Daily Development"],
    ["⛏️　难题攻坚", "⛏️　Hard Problems"],
    ["🔁　后台自动化", "🔁　Background Automation"],
    ["🦞　跑龙虾类任务", "🦞　Long-running Agent Tasks"],
    ["智力", "Intelligence"],
    ["共 ", ""],
    ["最近 ", "Past "],
    ["综合成本", "combined cost"],
    ["平均耗时", "average runtime"],
    ["平均价格", "average cost"],
    ["全屏查看", "View full screen: "],
    ["个模型档位", " model tiers"],
    ["横轴从有效样本最低值开始", "the x-axis starts at the lowest valid sample"],
    ["使用对数刻度展开低值并压缩高值", "a log scale expands low values and compresses high values"],
    ["低价离群区间使用断轴压缩", "a broken axis compresses the low-cost outlier range"],
    ["按“2.5 倍价格可换 1.35 倍速度”的权重折算",
      "weighted so 2.5× cost is equivalent to 1.35× speed"],
    ["图中最高综合成本归一为 100", "the highest combined cost is normalized to 100"],
    ["模型 / 强度 / 阶梯 / 档内临界", "model / effort / monotonicity / within-tier threshold"],
    ["（模型 ", " (model "],
    ["综合区分度", "overall discrimination"],
    ["档内临界", "within-tier threshold"],
    ["强度", "effort"],
    ["阶梯", "monotonicity"],
    ["样本", "samples"],
    ["推荐规则", "Selection rule"],
    ["性价比位", "Value pick"],
    ["聪明位", "High-IQ pick"],
    ["整数 IQ", "rounded IQ"],
    ["按费用与耗时综合成本最低取 1 个", "choose the lowest combined time-and-cost option"],
    ["按综合成本最低取 1 个", "choose the lowest combined-cost option"],
    ["所有有实测数据的档位中，按 IQ 从高到低取 2 个",
      "choose the two highest-IQ tiers with measured data"],
    ["IQ 相同时按模型顺序与综合成本排序",
      "break IQ ties by model order and combined cost"],
    ["只看平均费用，取费用最低的 2 个", "choose the two lowest average-cost tiers"],
    ["费用相同优先 IQ 更高", "break cost ties by higher IQ"],
    ["按费用与耗时综合成本最低取 2 个", "choose the two lowest combined time-and-cost tiers"],
    ["自身历史", "Own history"],
    ["最近三次平滑口径", "latest-three smoothed window · "],
    ["下降 ", "down "],
    ["回升 ", "up "],
    ["较24小时高点", "from 24h high"],
    ["较48小时高点", "from 48h high"],
    ["总览纵轴波动已放大 2 倍", "overview y-axis movement is magnified 2×"],
    ["IQ 分数走势", "IQ trend"],
    ["同色虚线", "matching dashed line"],
    ["平均 IQ", "average IQ"],
    ["统一纵轴跨度", "shared y-axis span"],
    ["历史点还不足", "does not yet have"],
    ["降智曲线", "Performance trend"],
    ["这里将显示每小时 IQ 分数走势", "hourly IQ scores will appear here"],
    ["IQ 分 = 通过率 ×150", "IQ = pass rate × 150"],
    ["当前曲线只是示意图，不代表任何实测结果", "this preview is not measured data"],
    ["每格测得越多、数据攒够后会自动换成真实曲线",
      "it switches to a real chart automatically as enough cell data accumulates"],
    ["所选档位的历史点还不足", "the selected tiers do not yet have"],
    ["暂时无法绘制对比曲线", "not enough data to draw a comparison chart"],
    ["数据不足未绘制", "not drawn due to insufficient data"],
    ["所有曲线共用纵轴", "all lines share the y-axis"],
    ["所选档位加权平均 IQ", "weighted average IQ of selected tiers"],
    ["跑一次 ≈", "One run ≈"],
    ["周额度", "of weekly quota"],
    ["最近一次判分实得", "Latest graded run earned"],
    ["累计通过", "Passed overall"],
    ["点击选中", "Select this cell"],
    ["冷却中", "Cooling down"],
    ["后重开抢首跑", " · Reopens for the next run"],
    ["后重开", " · Reopens in"],
    ["已认领，还没开跑", "Claimed · Not started"],
    ["已认领，待开跑", "Claimed · Waiting to start"],
    ["正在解题", "Running"],
    ["份提交判分中", " submissions being graded"],
    ["编程语言", "Programming language"],
    ["最近跑过这格", "Most recent runner"],
    ["未通过", "failed"],
    ["通过", "passed"],
    ["实耗 $", "actual $"],
    ["估价 $", "estimated $"],
    ["月榜冠亚季军得", "Monthly top 3 win "],
    ["北京时间", "Beijing time"],
    ["距结算", "remaining"],
    ["月初积分重赛", "monthly points reset"],
    ["总榜永久累计", "all-time points remain"],
    ["正在擦车", "Wrapping up"],
    ["路正在蹬", " workers running"],
    ["路正在冲线", " workers finishing"],
    ["路并发正在蹬", " concurrent workers running"],
    ["本月提交", "Monthly submissions"],
    ["总提交", "Total submissions"],
    ["分钟", " min"],
    ["小时", " hr"],
    ["积分", " points"]
  ];

  var SORTED_PHRASES = PHRASES.map(function (pair) {
    return [pair[0].trim(), pair[1]];
  }).sort(function (a, b) { return b[0].length - a[0].length; });
  var SORTED_TOKENS = TOKENS.slice().sort(function (a, b) {
    return b[0].length - a[0].length;
  });

  function hasHan(value) {
    return /[\u3400-\u9fff\uf900-\ufaff，。；：]/.test(String(value));
  }

  function translateCore(value) {
    if (Object.prototype.hasOwnProperty.call(EXACT, value)) return EXACT[value];
    var result = value;
    for (var i = 0; i < PATTERNS.length; i += 1) {
      var pattern = PATTERNS[i][0], replacement = PATTERNS[i][1];
      if (pattern.test(result)) {
        pattern.lastIndex = 0;
        result = result.replace(pattern, replacement);
        break;
      }
      pattern.lastIndex = 0;
    }
    for (var j = 0; j < SORTED_PHRASES.length; j += 1) {
      if (result.indexOf(SORTED_PHRASES[j][0]) !== -1) {
        result = result.split(SORTED_PHRASES[j][0]).join(SORTED_PHRASES[j][1]);
      }
    }
    for (var k = 0; k < SORTED_TOKENS.length; k += 1) {
      if (result.indexOf(SORTED_TOKENS[k][0]) !== -1) {
        result = result.split(SORTED_TOKENS[k][0]).join(SORTED_TOKENS[k][1]);
      }
    }
    if (result !== value) {
      result = result.replace(/，/g, ", ").replace(/；/g, "; ")
        .replace(/（/g, " (").replace(/）/g, ")").replace(/：/g, ": ")
        .replace(/。/g, ".").replace(/、/g, ", ")
        .replace(/(\d+)\s*次/g, "$1 samples")
        .replace(/(\d+)\s*天/g, "$1 days")
        .replace(/(\d)\s{2,}(hr|min)(?=[A-Za-z])/g, "$1 $2 ")
        .replace(/[ \t]{2,}/g, " ");
    }
    return result;
  }

  function translateText(value) {
    var input = String(value == null ? "" : value);
    if (!hasHan(input)) return input;
    if (/[\r\n]/.test(input)) {
      return input.split(/(\r?\n)/).map(function (part) {
        return /^\r?\n$/.test(part) ? part : translateText(part);
      }).join("");
    }
    var leading = (input.match(/^\s*/) || [""])[0];
    var trailing = (input.match(/\s*$/) || [""])[0];
    var core = input.slice(leading.length, input.length - trailing.length);
    return leading + translateCore(core) + trailing;
  }

  function languageFromEnvironment() {
    var query = new URLSearchParams(root.location ? root.location.search : "");
    var requested = query.get("lang");
    if (requested === "en" || requested === "zh") return requested;
    if (root.location && /^\/en\/?$/.test(root.location.pathname)) return "en";
    try {
      var stored = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "zh") return stored;
    } catch (_) {}
    return "zh";
  }

  function shouldSkip(element) {
    return !!(element && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|CODE|PRE)$/.test(element.tagName));
  }

  function translateTextNode(node) {
    if (!node || !node.parentElement || shouldSkip(node.parentElement)) return;
    var current = node.nodeValue;
    var record = textRecords.get(node);
    if (currentLanguage === "zh") {
      if (record && current !== record.source) node.nodeValue = record.source;
      return;
    }
    if (record && current === record.translated) return;
    var source = current;
    var translated = translateText(source);
    if (translated === source) return;
    record = {source: source, translated: translated};
    textRecords.set(node, record);
    translatedTextNodes.add(node);
    node.nodeValue = translated;
  }

  function translateAttribute(element, name) {
    if (!element || !element.hasAttribute(name)) return;
    var records = attributeRecords.get(element);
    var record = records && records[name];
    var current = element.getAttribute(name);
    if (currentLanguage === "zh") {
      if (record && current !== record.source) element.setAttribute(name, record.source);
      return;
    }
    if (record && current === record.translated) return;
    var translated = translateText(current);
    if (translated === current) return;
    if (!records) {
      records = {};
      attributeRecords.set(element, records);
    }
    records[name] = {source: current, translated: translated};
    translatedElements.add(element);
    element.setAttribute(name, translated);
  }

  function translateElement(element) {
    if (!element || shouldSkip(element)) return;
    ATTRIBUTES.forEach(function (name) { translateAttribute(element, name); });
    if (element.tagName === "META" && element.hasAttribute("content")) {
      translateAttribute(element, "content");
    }
    Array.prototype.slice.call(element.childNodes || []).forEach(function (child) {
      if (child.nodeType === 3) translateTextNode(child);
      else if (child.nodeType === 1) translateElement(child);
    });
  }

  function forgetDetachedNode(node) {
    if (!node || node.isConnected) return;
    if (node.nodeType === 3) {
      translatedTextNodes.delete(node);
      return;
    }
    if (node.nodeType !== 1) return;
    translatedElements.delete(node);
    Array.prototype.slice.call(node.childNodes || []).forEach(forgetDetachedNode);
  }

  function restoreChinese() {
    translatedTextNodes.forEach(function (node) {
      var record = textRecords.get(node);
      if (record && node.isConnected && node.nodeValue !== record.source) node.nodeValue = record.source;
    });
    translatedElements.forEach(function (element) {
      var records = attributeRecords.get(element);
      if (!records || !element.isConnected) return;
      Object.keys(records).forEach(function (name) {
        if (element.getAttribute(name) !== records[name].source) {
          element.setAttribute(name, records[name].source);
        }
      });
    });
  }

  function updateLanguageButton() {
    if (!documentRef) return;
    var button = documentRef.getElementById("language-switch");
    if (!button) return;
    var english = currentLanguage === "en";
    button.textContent = english ? "中文" : "EN";
    button.setAttribute("aria-label", english ? "Switch to Chinese" : "Switch to English");
    button.setAttribute("aria-pressed", String(english));
    button.setAttribute("title", english ? "Switch to Chinese" : "Switch to English");
  }

  function isHomePath(pathname) {
    return pathname === "/" || pathname === "/index.html" ||
      pathname === "/en" || pathname === "/en/";
  }

  function localizeUrl(url) {
    if (isHomePath(url.pathname)) {
      url.pathname = currentLanguage === "en" ? "/en" : "/";
      url.searchParams.delete("lang");
    } else if (currentLanguage === "en") {
      url.searchParams.set("lang", "en");
    } else {
      url.searchParams.delete("lang");
    }
    return url;
  }

  function syncInternalLinks() {
    if (!documentRef || !root.location) return;
    Array.prototype.slice.call(documentRef.querySelectorAll("a[href]")).forEach(function (link) {
      var raw = link.getAttribute("href") || "";
      if (raw.charAt(0) !== "/" || raw.indexOf("//") === 0) return;
      var url = localizeUrl(new URL(raw, root.location.href));
      link.setAttribute("href", url.pathname + url.search + url.hash);
    });
  }

  function updateUrl() {
    if (!root.history || !root.location || root.location.protocol === "about:") return;
    var url = localizeUrl(new URL(root.location.href));
    root.history.replaceState(root.history.state, "", url.pathname + url.search + url.hash);
  }

  function applyLanguage(language, options) {
    currentLanguage = language === "en" ? "en" : "zh";
    if (documentRef) {
      documentRef.documentElement.lang = currentLanguage === "en" ? "en" : "zh-CN";
      documentRef.documentElement.setAttribute("data-language", currentLanguage);
      if (currentLanguage === "en") translateElement(documentRef.documentElement);
      else restoreChinese();
      updateLanguageButton();
      syncInternalLinks();
    }
    try {
      if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, currentLanguage);
    } catch (_) {}
    if (options && options.updateUrl) updateUrl();
    if (documentRef) {
      documentRef.dispatchEvent(new CustomEvent("dradar:languagechange", {
        detail: {language: currentLanguage}
      }));
    }
  }

  function installObserver() {
    if (!documentRef || typeof MutationObserver === "undefined") return;
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === "characterData") {
          translateTextNode(mutation.target);
        } else if (mutation.type === "attributes") {
          translateAttribute(mutation.target, mutation.attributeName);
        } else {
          Array.prototype.slice.call(mutation.removedNodes || []).forEach(forgetDetachedNode);
          Array.prototype.slice.call(mutation.addedNodes || []).forEach(function (node) {
            if (node.nodeType === 3) translateTextNode(node);
            else if (node.nodeType === 1) translateElement(node);
          });
        }
      });
    });
    observer.observe(documentRef.documentElement, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ATTRIBUTES.concat(["content"])
    });
  }

  root.DRadarI18n = {
    language: function () { return currentLanguage; },
    isEnglish: function () { return currentLanguage === "en"; },
    locale: function () { return currentLanguage === "en" ? "en-US" : "zh-CN"; },
    translateText: translateText,
    setLanguage: function (language) { applyLanguage(language, {updateUrl: true}); }
  };

  if (!documentRef) return;
  currentLanguage = languageFromEnvironment();
  applyLanguage(currentLanguage, {updateUrl: true});
  installObserver();
  var switchButton = documentRef.getElementById("language-switch");
  if (switchButton) {
    switchButton.addEventListener("click", function () {
      applyLanguage(currentLanguage === "en" ? "zh" : "en", {updateUrl: true});
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
