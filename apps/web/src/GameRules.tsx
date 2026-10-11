import { useEffect, useState } from "react";
import type { Card } from "@seasalt/game";
import { CardView } from "./cards.js";

const PAIRS: Pick<Card, "type" | "color">[] = [
  { type: "crab", color: "darkBlue" },
  { type: "boat", color: "lightBlue" },
  { type: "fish", color: "black" },
  { type: "shark", color: "green" },
  { type: "swimmer", color: "yellow" },
];
const OTHERS: Pick<Card, "type" | "color">[] = [
  { type: "shell", color: "gray" },
  { type: "octopus", color: "purple" },
  { type: "penguin", color: "lightOrange" },
  { type: "sailor", color: "pink" },
  { type: "mermaid", color: "white" },
];
const MULTIPLIERS: Pick<Card, "type" | "color">[] = [
  { type: "lighthouse", color: "purple" },
  { type: "shoal", color: "gray" },
  { type: "colony", color: "green" },
  { type: "captain", color: "lightOrange" },
];

/** 规则说明：一个按钮，点开是像素弹窗。用自己的话写，不照搬原版规则书。 */
function GameRules() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className="quiet-button ss-rules-button" type="button" aria-expanded={open} onClick={() => setOpen(true)}>规则</button>
      {open && (
        <div className="gm-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="gm-panel ss-rules" role="dialog" aria-modal="true" aria-labelledby="ss-rules-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="ss-rules-title">海盐与纸怎么玩</h2>
            <div className="game-rules-block">
              <h3>目标</h3>
              <p>
                一轮一轮地收集卡牌攒分。目标分：<b>2 人 40</b>、<b>3 人 35</b>、<b>4 人 30</b>。有人到了目标分，那一轮结算完游戏结束，<b>总分最高</b>的人获胜
                （一样高比最后一轮的得分，再一样就并列）。谁集齐 <b>4 张美人鱼</b>，立刻获胜。
              </p>
            </div>
            <div className="game-rules-block">
              <h3>每一轮、每一回合</h3>
              <ol>
                <li>每轮开始时 58 张全部洗匀，翻两张各起一个弃牌堆。从上一轮结束者的左手边开始。</li>
                <li><b>拿牌</b>（二选一）：从牌堆摸两张，留一张，另一张正面朝上丢进一个弃牌堆（有空堆就必须丢进空堆）；或者拿走一个弃牌堆顶上的那张。弃牌堆只能看顶上一张。</li>
                <li><b>打对子</b>（可以不打，也可以打好几对）：把一对牌摆到面前，马上发动效果。</li>
                <li><b>宣告结束本轮</b>（可以不宣告）：卡牌分（手里 + 面前）到 <b>7 分</b>才能宣告，选 STOP 或最后机会。不宣告就轮到下一位。</li>
              </ol>
            </div>
            <div className="game-rules-block">
              <h3>对子牌：每一对 1 分，打出来才有效果</h3>
              <div className="ss-rules-cards" aria-hidden="true">{PAIRS.map((card) => <CardView key={card.type} card={card} />)}</div>
              <ul>
                <li><b>两只蟹</b>：选一个弃牌堆，翻看整堆，挑一张拿进手里（别人不知道你拿了哪张）。</li>
                <li><b>两艘船</b>：马上再来一回合。</li>
                <li><b>两条鱼</b>：从牌堆顶摸一张。</li>
                <li><b>鲨鱼 + 泳者</b>：从一位对手手里随机偷一张。</li>
                <li>手里凑成的对子不打出来也算分；效果用不了的对子（比如弃牌堆都空了）也能打出来，只是没效果。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>收集牌和美人鱼</h3>
              <div className="ss-rules-cards" aria-hidden="true">{OTHERS.map((card) => <CardView key={card.type} card={card} />)}</div>
              <ul>
                <li><b>贝壳</b> 1–6 张：0 / 2 / 4 / 6 / 8 / 10 分；<b>章鱼</b> 1–5 张：0 / 3 / 6 / 9 / 12 分；<b>企鹅</b> 1–3 张：1 / 3 / 5 分；<b>水手</b> 1–2 张：0 / 5 分。</li>
                <li><b>美人鱼</b>：把你各颜色的张数从多到少排，第 1 张美人鱼得最多那种颜色的张数，第 2 张得第二多的，依此类推。美人鱼自己算白色。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>乘数牌（各 1 张，不算自己）</h3>
              <div className="ss-rules-cards" aria-hidden="true">{MULTIPLIERS.map((card) => <CardView key={card.type} card={card} />)}</div>
              <ul>
                <li><b>灯塔</b>：每艘船 +1；<b>鱼群</b>：每条鱼 +1；<b>企鹅群</b>：每只企鹅 +2；<b>船长</b>：每个水手 +3。手里和面前的都算。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>结束本轮</h3>
              <ul>
                <li><b>STOP</b>：这一轮立刻结束，每个人拿自己的卡牌分。</li>
                <li>
                  <b>最后机会</b>：你亮出手牌，其他人各再打一回合（打完也亮牌；亮出的手牌不能被偷）。然后比卡牌分：
                  你最高（平分也算）就是<b>赌赢了</b>，你拿卡牌分 + 颜色奖励，其他人只拿颜色奖励；有人比你高就是<b>赌输了</b>，你只拿颜色奖励，其他人拿卡牌分。
                </li>
                <li><b>颜色奖励</b>：你最多的那种颜色有几张（手里 + 面前）。只在最后机会时算。</li>
                <li>有人回合结束时<b>牌堆空了</b>（又没人宣告），这一轮作废，谁都不得分。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>其他</h3>
              <ul>
                <li>牌的颜色（58 张）：深蓝 9、浅蓝 9、黑 8、黄 8、绿 6、白 4（就是 4 张美人鱼）、紫 4、灰 4、浅橙 3、粉 2、橙 1。</li>
                <li>每个决定限时 45 秒，超时自动处理：拿牌时从牌堆摸两张，留分高的那张，另一张丢左边（有空堆丢空堆）；出牌时直接结束回合，不宣告；蟹挑张数多的那一堆里分最高的牌；偷手牌最多的对手。连续超时 2 次转托管：由人机替你打，点「取消托管」或自己动一下就交还；轮到的人离线 3 秒后也由人机代打。</li>
                <li>快捷键：D 摸牌堆，1 / 2 拿左 / 右弃牌堆，E 结束回合，S STOP，L 最后机会，N 下一轮。</li>
              </ul>
            </div>
            <div className="gm-panel-actions">
              <button className="primary-button" type="button" onClick={() => setOpen(false)}>知道了</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default GameRules;
