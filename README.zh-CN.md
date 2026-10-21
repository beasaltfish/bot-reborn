# bot-reborn

[English](README.md) | 中文

**把一个 30 块钱的玩具机器人改成 AI 机器人：旧手机当身体，电脑当大脑。**

[![真狗在吃饭，机器狗陪着孩子玩](docs/media/demo.gif)](https://youtube.com/shorts/SNA9ok1j0Sg)

*真狗：忙着吃饭。机器狗：正在值班。* — [看带声音的短视频](https://youtube.com/shorts/SNA9ok1j0Sg)

[![机器人在书桌上回答孩子写作业时问的科学问题](docs/media/homework.gif)](https://youtube.com/shorts/3Y984t1W6nc)

*孩子：问题很多。机器人：脾气不小。* — [看带声音的短视频](https://youtube.com/shorts/3Y984t1W6nc)

**📖 完整的改造故事：[我把一台 30 块钱的玩具机器人，改成了会顶嘴的 AI 机器人](https://agentlenshq.com/zh-CN/maker/four-dollar-robot)**

<table>
  <tr>
    <td align="center"><img src="docs/media/before.jpg" height="320" alt="买来时的样子：盒装的 Silverlit Maze Breaker"></td>
    <td align="center"><img src="docs/media/phone-mount.jpg" height="320" alt="去掉头的机器人上，用纸板马鞍和橡皮筋固定着一台手机，屏幕上是机器人的脸"></td>
  </tr>
  <tr>
    <td align="center">改造前：一个巡线玩具</td>
    <td align="center">改造后：头没了，手机就是脸</td>
  </tr>
</table>

## 它能做什么

- **你说话，它开车、回答。** 比如"往前走两秒，然后左转"。
- **反射：聊天模型还没开始想，它已经动了。** 可选功能。一个小的决策模型先听
  每一句话，从你写好的几个答案里挑一个。每个答案做什么由你定：放个声音、
  动一下、停下，或者把这一轮交给聊天模型。自带两个预设：*学狗叫就叫回去*，
  和*简单移动命令*（"停"、"过来"、"左转"立刻执行）。预设只是数据，在管理页
  里随便改。
- **亮屏就在听。** 不需要唤醒词，想要也可以打开。按停止键，车马上停，不管它正在
  干什么。
- **一个大脑，多个角色。** 每个机器人是一个角色，有自己的名字、声音、服务商和
  key，都在浏览器里的管理页上配置，界面有中文和英文。

## 你需要准备

- **一个便宜的玩具机器人或玩具车**，有驱动电机和转向。我们用的是 Silverlit
  Maze Breaker，目前只测过这一款，但用同类电机驱动芯片的玩具应该都一样能用。
- **一块 FT232H 转接板**，连接手机的 USB 口和玩具的电机驱动。
- **一台装了 Chrome 的安卓手机。** 手机通过 WebUSB 控制转接板，iPhone 没有
  WebUSB。另外还要一根接转接板的 USB-C 线。
- **API key**：语音转文字、聊天模型、文字转语音各一个。任何兼容 OpenAI 接口的
  服务商都行，管理页里预置了常用的几家。
- **反射（可选）**：一个决策模型，可以是 JEV，也可以是用
  [Unsloth](https://github.com/unslothai/unsloth) 训练、在 `/v1/systemone`
  上提供服务的模型。"简单移动命令"预设的题目和
  [`training/commands/`](training/commands/) 训练出的模型一字不差。
- 电烙铁、几根线、纸板和橡皮筋。

还没有车？把角色的身体设成**演练**，动作只写进大脑的日志；或者设成**不能动**，
做一个只会说话的机器人。这样手机就完全不用接转接板。

## 原理

![玩具自带的电路板，FT232H 的线接在电机和转向的输入上](docs/media/wiring.jpg)

玩具自带的巡线芯片被绕开了。FT232H 引出四根线，直接接到玩具电机驱动和转向线圈
的输入端，手机通过 USB 控制这四个引脚。手机是机器人的身体：听、播放、开车、
显示表情。所有做决定的事——听到自己的名字、理解、决定做什么、回话——都在同一个
Wi-Fi 下一台电脑上的小 Node 服务里运行，这就是机器人的大脑。

## 自己做一个

1. **接线。** 引脚图、接线方法和各项测量数据在
   [`docs/hardware.md`](docs/hardware.md)（英文）。动手之前先看里面关于 D6/D7
   焊接的警告。
2. **启动大脑**，在和手机连同一个 Wi-Fi 的电脑上：

   ```bash
   npm install
   server/models/fetch.sh   # 唤醒词和 VAD 模型，只需一次
   npm start
   ```

   浏览器会自动打开管理页，左下角可以切到中文。新建一个角色，选好它的身体，
   给每一层（听、想、说，以及可选的反射）选服务商、填 key；每填一个，页面就会
   测一下能不能用。第二个角色可以直接从第一个复制服务商，连 key 一起复制。

   ![管理页：一个角色的基本设置，以及手机扫码成为它身体用的二维码](docs/media/admin.png)
3. **让手机上的 Chrome 允许这个页面使用 USB 和麦克风**，每台手机做一次：打开
   `chrome://flags/#unsafely-treat-insecure-origin-as-secure`，填入管理页上显示
   的地址（`http://<电脑>:8787`），设为 Enabled，然后重启 Chrome。这个页面是
   局域网里的普通 http，而 Chrome 只在它认为安全的页面上开放 USB 和麦克风。
   在路由器上给电脑固定一个 IP，就不用反复设置。
4. **用手机扫管理页上这个角色的二维码**，插上转接板，按"开始听"。机器人会显示
   还缺什么，每一项缺的就是一步：插上转接板、教它哪边是左。没插转接板的手机也
   照样能听能说。

你的 key 只存在电脑上 `~/.bot-reborn/` 下的一个文件里，只有你的用户能读，也只
发给你选的服务商。手机永远看不到 key：它手里只有一个说明"我是哪个角色"的口令。
详见 [Security](docs/development.md#security)（英文）。

## 现状

在一台机器人、一台手机上已经从头到尾跑通。有些硬件参数还没测。可配置反射和
简单移动命令模型是新做的，还没在车上用真人声音试过，所以 0.8 的触发阈值只是
初步的猜测。

## 更多

以下文档都是英文：

- [`docs/hardware.md`](docs/hardware.md) — 接线、引脚图、每一项测量
- [`docs/development.md`](docs/development.md) — 怎么读代码、怎么运行、测试、
  安全
- [`docs/instruments.md`](docs/instruments.md) — 齿轮图标后面的校准页
- [`docs/ui.md`](docs/ui.md) — 机器人的脸，以及每种状态的含义
- [`docs/promo-video.md`](docs/promo-video.md) — 做宣传视频学到的东西
- [`training/commands/`](training/commands/) — 简单移动命令的数据集、生成脚本和
  模型说明

## 许可证

[MIT](LICENSE)。`server/sounds/` 里的音效是 CC0，见
[来源说明](server/sounds/CREDITS.md)。
