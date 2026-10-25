import { Button, Modal, Tag } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GALLERY } from "../workshop/gallery/index.ts";
import { useEditor } from "../editor/store.ts";

/* ------------------------------------------------------------------ *
 * EDU-01：首次进入的 5 步引导
 *
 * 只解决一件事：让人在 30 秒内知道「先做什么、卡住了怎么办」。
 * 所以每一步都给了可点的出口（序章 / 沙盒 / 工坊 / 手册），而不是纯文字。
 * 看过一次就不再自动弹（localStorage），但书架上的按钮永远在。
 * ------------------------------------------------------------------ */

const KEY = "cpu-guide-seen-v1";

export function guideSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

export function markGuideSeen(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* 无所谓：下次再弹一次而已 */
  }
}

const LEVELS_TOTAL = 31 + 18 + 8;

interface Step {
  title: string;
  body: React.ReactNode;
}

export default function GuideModal({
  open,
  onClose,
  onGoHelp,
}: {
  open: boolean;
  onClose: () => void;
  onGoHelp?: () => void;
}) {
  const [i, setI] = useState(0);
  const navigate = useNavigate();
  const setPanel = useEditor((s) => s.setPanel);
  const setBook = useEditor((s) => s.setBook);

  const steps: Step[] = [
    {
      title: "这是什么",
      body: (
        <>
          <p className="desc">
            一台「从逻辑门自己搭出来」的 16 位处理器沙盒：三本书共 <b>{LEVELS_TOTAL} 关</b>，外加一个{" "}
            <b>{GALLERY.length} 个案例</b>的电路工坊。
          </p>
          <p className="teach">
            CPU 书从与非门走到能跑汇编的 Z16；存储书把 DRAM / Flash / 磁盘的物理翻译成拍数与预算；优化书把延迟和冒险变成可拼的电路。
            关卡里没有「代码填空」，全都是连线、接元件、跑测试。
          </p>
          <div className="chips">
            <Tag color="purple">不需要预备知识</Tag>
            <Tag color="cyan">每关都有讲解与提示</Tag>
            <Tag color="green">答错了会指出具体的线</Tag>
          </div>
        </>
      ),
    },
    {
      title: "先走这三关（约 10 分钟）",
      body: (
        <>
          <p className="desc">序章三关不含任何陷阱，专门用来习惯「拖元件、连线、跑测试」的手感：</p>
          <ol className="teach" style={{ paddingLeft: 18 }}>
            <li>
              <b>点亮信号灯</b>：开关直接接到灯，先体会「组合电路没有记忆」。
            </li>
            <li>
              <b>修好断开的信号线</b>：灯不亮不是坏了，是线没接。
            </li>
            <li>
              <b>记忆门只在约定时刻收件</b>：D 触发器为什么必须等时钟沿。
            </li>
          </ol>
          <p className="teach">走完这三关，第一层的与非门会顺手很多。</p>
        </>
      ),
    },
    {
      title: "界面就三块",
      body: (
        <>
          <ul className="teach" style={{ paddingLeft: 18 }}>
            <li>
              <b>左边：元件库</b>。点一下或拖进画布；灰色的是这一关不让用的。
            </li>
            <li>
              <b>中间：画布</b>。<code>空格</code> 运行/暂停、<code>→</code> 单拍、<code>W</code> 连线、
              <code>R</code> 旋转、<code>F</code> 适应视图、<code>⌘Z</code> 撤销。
            </li>
            <li>
              <b>右边：面板</b>。关卡（题目与测试）、属性（选中元件的参数）、汇编（写 Z16 程序）、CPU（寄存器视图）、工坊（100 个案例）、探针、日志、手册。
            </li>
          </ul>
          <p className="teach">
            线的颜色代表电平高低；没接的引脚会标「未驱动」——这类提示比报错更有用，它告诉你是哪一根没接。
          </p>
        </>
      ),
    },
    {
      title: "卡住了怎么办（按这个顺序）",
      body: (
        <>
          <ol className="teach" style={{ paddingLeft: 18 }}>
            <li>
              <b>看关卡面板里的「提示」</b>：一句话指出这一关的关键动作，不给答案。
            </li>
            <li>
              <b>点「看参考解」</b>：官方解答会直接载进画布，<code>⌘Z</code> 可退回。载入后会记一笔「看过答案」——判题照旧，但不假装是自己做出来的。
            </li>
            <li>
              <b>去工坊案例库找同类</b>：100 个案例都带「为什么值得看」和端口说明，可以放进画布拆开看。
            </li>
            <li>
              <b>翻手册</b>：快捷键、Z16 指令集、常见诊断都在里面。
            </li>
          </ol>
          <p className="teach">不丢人，也不扣分：这几个出口是故意做在界面里的。</p>
        </>
      ),
    },
    {
      title: "想做点别的",
      body: (
        <>
          <ul className="teach" style={{ paddingLeft: 18 }}>
            <li>
              <b>自由搭建沙盒</b>：没有判题，随便接，做坏了有项目历史兜底。
            </li>
            <li>
              <b>工坊 · 案例库</b>：从半加器到迷你 CPU，100 个电路都能一键放进画布，每个都带模型对拍（当场可重跑自检）。
            </li>
            <li>
              <b>汇编面板</b>：给参考 Z16 写程序，看它在寄存器里怎么跑。
            </li>
            <li>
              <b>打包子电路</b>：选中几个元件按 <code>G</code>，它就成了你自己的组件，可在工坊里复用。
            </li>
          </ul>
        </>
      ),
    },
  ];

  const last = i === steps.length - 1;

  const finish = (to?: "prologue" | "sandbox" | "workshop" | "help") => {
    markGuideSeen();
    onClose();
    if (!to) return;
    if (to === "prologue") {
      setBook("logic");
      useEditor.getState().startLevel("prologue-light");
      navigate("/lesson");
      return;
    }
    if (to === "help") {
      onGoHelp?.();
      return;
    }
    useEditor.getState().openSandbox();
    navigate("/sandbox");
    setPanel(to === "workshop" ? "workshop" : "inspector");
  };

  return (
    <Modal
      open={open}
      width={640}
      title={`上手引导 · ${i + 1}/${steps.length} · ${steps[i].title}`}
      onCancel={() => finish()}
      footer={[
        <Button key="skip" type="text" onClick={() => finish()}>
          跳过
        </Button>,
        i > 0 && (
          <Button key="prev" onClick={() => setI(i - 1)}>
            上一步
          </Button>
        ),
        last ? (
          <Button key="go" type="primary" onClick={() => finish("prologue")}>
            从序章开始
          </Button>
        ) : (
          <Button key="next" type="primary" onClick={() => setI(i + 1)}>
            下一步
          </Button>
        ),
      ]}
    >
      <div className="guide-body">{steps[i].body}</div>
      <div className="chips" style={{ marginTop: 12 }}>
        <Button size="small" onClick={() => finish("prologue")}>
          序章三关
        </Button>
        <Button size="small" onClick={() => finish("workshop")}>
          工坊 100 案例
        </Button>
        <Button size="small" onClick={() => finish("sandbox")}>
          自由沙盒
        </Button>
        <Button size="small" onClick={() => finish("help")}>
          手册
        </Button>
      </div>
    </Modal>
  );
}
