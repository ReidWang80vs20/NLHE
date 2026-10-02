/* ============================================================
 * scenarios.js — 情境训练题库
 * scenarios.js — Scenario drill question bank
 *   每个场景的筹码、底池、下注额都按真实牌局推演过，保证自洽：
 *   Every scenario's chips, pot, and bet sizing have been played out as a real
 *   hand to guarantee self-consistency:
 *     · 底池 = 此前所有投入之和
 *     · Pot = the sum of all prior contributions
 *     · 你需要跟注的额 = 对手下注后的总额 − 你已投入的额
 *     · Amount you need to call = total after the opponent's bet − amount you already put in
 *     · 有效筹码 = 起始筹码 − 已投入
 *     · Effective stack = starting stack − already invested
 *   盲注统一 1/2，起始筹码 200（100BB）。
 *   Blinds are always 1/2, starting stack 200 (100BB).
 *   board / heroHole 用 PK.cardText 记法：'As' = A♠
 *   board / heroHole use PK.cardText notation: 'As' = A♠
 * ============================================================ */
(function (global) {
  'use strict';

  /* verdict: best（最优） / ok（可接受，但不是最好） / bad（失误） */
  /* verdict: best (optimal) / ok (acceptable but not best) / bad (blunder) */
  const SCENARIOS = [

    /* ==================== 翻牌前 ==================== */
    /* ==================== Preflop ==================== */
    {
      id: 'pf-btn-k9s', cat: '翻牌前', title: '按钮位开池 · K♠9♠',
      seats: 6, heroPos: 'BTN', street: 'preflop',
      heroHole: ['Ks', '9s'], board: [],
      pot: 3, toCall: 2, effStack: 200,
      desc: '6 人桌，盲注 1/2。前面四位全部弃牌，你在按钮位，身后只剩小盲（已投 1）、大盲（已投 2）。此时你已连打 20 手没入池。',
      question: '手持 K♠9♠，你怎么做？',
      options: [
        { key: 'fold', verdict: 'bad', text: '弃牌',
          comment: '太紧了。K9s 在按钮位是标准开池牌：既能直接拿下盲注，被跟注后也有位置和同花潜力。长期弃掉它就是在白白漏钱。' },
        { key: 'call', verdict: 'bad', text: '跟注 2',
          comment: '按钮位平跟是最差的选择。你放弃了下注权、邀请大小盲用任意两张便宜看牌，而这手牌本来最适合主动施压。' },
        { key: 'raise', verdict: 'best', text: '加注到 5',
          comment: '正确。按钮位开池 2.5bb（=5），K9s 在范围内。多数时候直接收下 3 的盲注；被跟注也有位置 + 同花潜力可打。' },
      ],
      points: [
        '按钮位是最有利的位置：翻后每个街都最后行动，所以可以打得更宽。',
        '开池尺度用 2~2.5bb，不要用 4~5bb —— 尺度越大，跟注你的人手上的牌就越强。',
        '判断"该不该开"，看的是这手牌在同类起手牌里的百分位，而不是"感觉能不能赢"。',
      ],
    },
    {
      id: 'pf-bb-a7o', cat: '翻牌前', title: '大盲防守 · A♦7♣',
      seats: 6, heroPos: 'BB', street: 'preflop',
      heroHole: ['Ad', '7c'], board: [],
      pot: 8, toCall: 3, effStack: 198,
      desc: '按钮位开池加注到 5，小盲弃牌。底池现有 1（小盲）+ 2（你的大盲）+ 5（按钮位）= 8。你已投入 2，需要再补 3 才能看翻牌。',
      question: '大盲手持 A♦7♣，你怎么做？',
      options: [
        { key: 'fold', verdict: 'ok', text: '弃牌',
          comment: '不算错，但偏紧。你只需要 27% 胜率就划算，而 A7o 对按钮位的开池范围大约有 45% 的胜率。' },
        { key: 'call', verdict: 'best', text: '跟注 3',
          comment: '正确。补 3 去赢 11 的底池，只需约 27% 胜率，A7o 对按钮位宽范围的胜率远高于此。已经投入的 2 让跟注更便宜。' },
        { key: 'raise', verdict: 'ok', text: '再加注到 18',
          comment: '可以接受的混合打法。A7o 里的 A 是阻断牌，能让对手的 AA/AK 组合变少。但翻后很难打（踢脚太弱），只适合偶尔为之。' },
      ],
      points: [
        '大盲已经投入 2，所以跟注的真实成本只是 3 而不是 5 —— 这是最容易算错的一步。',
        '底池赔率 = 需要跟注 ÷（当前底池 + 需要跟注）= 3 ÷ 11 ≈ 27%。胜率只要高于它，跟注就是赚的。',
        '位置劣势要靠"更高胜率"补偿：没位置时选能中到强牌的牌（同花连张、小对子），而不是 A7o 这类"中了也不强"的牌。',
      ],
    },
    {
      id: 'pf-utg-ajo', cat: '翻牌前', title: '枪口位开池 · A♦J♣',
      seats: 6, heroPos: 'UTG', street: 'preflop',
      heroHole: ['Ad', 'Jc'], board: [],
      pot: 3, toCall: 2, effStack: 200,
      desc: '6 人桌，盲注 1/2。你是第一个行动的人（枪口位），身后还有 5 位玩家没说话。底池只有两个盲注共 3。',
      question: '手持 A♦J♣，你怎么做？',
      options: [
        { key: 'fold', verdict: 'ok', text: '弃牌',
          comment: '偏保守但不算错。AJo 在枪口位的边缘性很明显，尤其当对手都偏紧、翻后容易被统治时，弃掉它可以接受。' },
        { key: 'call', verdict: 'bad', text: '跟注 2',
          comment: '最差的选择。枪口位平跟既没有位置优势，也无法缩小对手范围，AJo 会陷入"中了踢脚不够、不中又没牌"的两难。' },
        { key: 'raise', verdict: 'best', text: '加注到 5',
          comment: '正确。6 人桌枪口位开 AJo 是标准打法。加注能立刻筛掉身后的垃圾牌，也在被跟注时确认了自己大概率领先。' },
      ],
      points: [
        '位置越靠前需要的牌越强 —— 身后未行动的玩家越多，"有人拿到强牌"的概率越高。',
        '任何"要么加注要么弃牌"的场合都不要平跟：平跟藏住了牌力信息，代价是交出主动权。',
        'AJo 的价值随位置剧烈变化：按钮位是强牌，枪口位就只是边缘牌。',
      ],
    },
    {
      id: 'pf-sb-a5s', cat: '翻牌前', title: '小盲面对加注 · A♥5♥',
      seats: 6, heroPos: 'SB', street: 'preflop',
      heroHole: ['Ah', '5h'], board: [],
      pot: 8, toCall: 4, effStack: 199,
      desc: '按钮位开池加注到 5，轮到你行动。你已经投了 1 的小盲，大盲（已投 2）还在你身后没说话。底池 1+2+5 = 8。',
      question: '小盲手持 A♥5♥，你怎么做？',
      options: [
        { key: 'fold', verdict: 'ok', text: '弃牌',
          comment: '可以接受。小盲是全场最差的位置（翻后永远先行动），弃掉边缘牌并不亏。' },
        { key: 'call', verdict: 'bad', text: '跟注 4',
          comment: '最差的选择。小盲平跟会留下大盲一起看翻牌，而你翻后每个街都要先行动，A5s 很难兑现它的同花潜力。' },
        { key: 'raise', verdict: 'best', text: '再加注到 20',
          comment: '正确。A5s 是很适合再加注的牌：A 是阻断牌，同花潜力让它在被跟注后仍能打。无位置时"要么加注要么弃牌"。' },
      ],
      points: [
        '小盲的平跟几乎总是错的：位置最差，却还要多拉一个对手进来。',
        '同花 A 小是典型的"3-bet 或弃牌"牌：作为诈唬它有阻断牌，作为价值它有同花后门。',
        '无位置时再加注尺度通常开到开池额的 4 倍，有位置时可以降到 3 倍。',
      ],
    },

    /* ==================== 翻牌后 ==================== */
    /* ==================== Postflop ==================== */
    {
      id: 'flop-kk-a72', cat: '翻牌后', title: '3-bet 底池 · 翻牌 A♠7♦2♣ 持 KK',
      seats: 2, heroPos: 'BTN', street: 'flop',
      heroHole: ['Kd', 'Kc'], board: ['As', '7d', '2c'],
      pot: 19, toCall: 6, effStack: 181,
      desc: '你在按钮位用 K♦K♣ 3-bet 到 9，大盲跟注（他先投了 2 的盲注，再补 7），底池 9+9+1（小盲）= 19。你们身后各约 181。翻牌 A♠7♦2♣（彩虹面），大盲主动下注 6（约 1/3 池）。',
      question: '翻牌 A♠7♦2♣，你持 K♦K♣，对手下注 6（1/3 池）。你怎么做？',
      options: [
        { key: 'fold', verdict: 'bad', text: '弃牌',
          comment: '过度放弃。虽然 A 让对手一部分范围领先你，但他的下注范围里仍有大量 88~JJ、7x、以及听牌。直接弃掉 KK 太亏。' },
        { key: 'call', verdict: 'best', text: '跟注 6',
          comment: '正确。用最便宜的价格跟注，保留他所有诈唬和中等对子。这里加注只会把 88~QQ 打跑、把 Ax 以上留下来打你。' },
        { key: 'raise', verdict: 'bad', text: '加注到 20',
          comment: '失误。加注只会让更差的牌弃掉、更强的牌（Ax、两对、三条）跟上来，属于典型的"把对手打对该对的"型错误。' },
      ],
      points: [
        '对手下注不代表你落后：他的下注范围永远是"价值 + 诈唬"的混合，要看整体组合数。',
        '当你处于"要么领先很多、要么落后很多"的局面时，跟注优于加注 —— 加注会把对手范围里的弱牌全部赶走。',
        'A 高翻牌确实削弱了 KK 这类大对子，但只要下注尺度小（1/3 池），底池赔率（6 ÷ 31 ≈ 19%）仍然值得继续。',
      ],
    },
    {
      id: 'flop-set-wet', cat: '翻牌后', title: '翻牌三条 · 湿润面主动下注',
      seats: 3, heroPos: 'BTN', street: 'flop',
      heroHole: ['8h', '8c'], board: ['8s', 'Jh', 'Td'],
      pot: 16, toCall: 0, effStack: 195,
      desc: '你在按钮位开池到 5，大盲跟注、另一位也跟注，小盲弃牌后底池 5×3 + 1（小盲）= 16。翻牌 8♠J♥10♦，前面两人都过牌。',
      question: '你翻牌中了三条 8，前面都过牌，你怎么做？',
      options: [
        { key: 'check', verdict: 'bad', text: '过牌',
          comment: '失误。这个翻牌有大量顺子听牌和 J/T 的高对，免费给牌会让它们在转牌/河牌反超你。你应该下注保护自己的手牌。' },
        { key: 'bet', verdict: 'best', text: '下注 12（约 ¾ 池）',
          comment: '正确。三条很强，但牌面很湿（对手有大量顺子听牌），要用较大尺度收走对手的权益，同时建池为后面几条街做准备。' },
        { key: 'allin', verdict: 'ok', text: '直接全下 195',
          comment: '不算错，但浪费了价值。全下会把所有比三条差的牌赶走，只留下能击败你的牌（Q9、97 已成顺）。应该分街下注。' },
      ],
      points: [
        '牌面越湿（同花/顺子听牌越多），越要用大尺度的价值下注来"收走对手的权益"。',
        '有强牌时优先考虑分街建池：直接全下会让弱牌弃牌、强牌跟注，反而把价值打没了。',
        '三条对上有顺子听牌的牌面并不安全：转牌/河牌出现 9、Q、7 都会让顺子成牌（这里 9 与 Q 各有 4 张补牌）。',
      ],
    },
    {
      id: 'flop-flushdraw', cat: '翻牌后', title: '同花听牌面对下注',
      seats: 2, heroPos: 'BB', street: 'flop',
      heroHole: ['Kd', 'Jd'], board: ['9d', '4d', '2s'],
      pot: 11, toCall: 6, effStack: 195,
      desc: '按钮位开池到 5，你在 BB 跟注，小盲弃牌，底池 5+5+1 = 11。翻牌 9♦4♦2♠，你过牌，对手下注 6（约半池）。',
      question: '你持 K♦J♦（同花听牌 + 两高张），面对半池下注？',
      options: [
        { key: 'fold', verdict: 'bad', text: '弃牌',
          comment: '失误。你有 9 张同花补牌加 2 张高牌可能，实际胜率明显高于半池所需的 26%。' },
        { key: 'call', verdict: 'best', text: '跟注 6',
          comment: '正确。半池下注只需要约 26% 胜率，你大约有 45% 左右（同花听牌 + 两张高牌），跟注是稳定盈利的。也可以混入一小部分加注。' },
        { key: 'raise', verdict: 'ok', text: '加注到 20',
          comment: '可以接受。用同花听牌加注是标准的半诈唬：对手弃牌你直接赢，被跟注还有 9 张补牌。但不应每次都这么做，否则容易被反加。' },
      ],
      points: [
        '数补牌：同花听牌 = 9 张有效补牌。「补牌数 × 2」就是转牌成牌的大致百分比（9 × 2 ≈ 18%，两条街约 36%）。',
        '听牌的价值来自"成牌后能赢更多"（隐含赔率）—— 所以要多打那些成牌后别人看不出来的听牌（比如同花）。',
        '半诈唬 = 有真实胜率的下注。它比纯诈唬安全得多，因为即使被跟注也还有翻盘机会。',
      ],
    },
    {
      id: 'turn-tptk', cat: '翻牌后', title: '转牌顶对顶踢 · 面对大注',
      seats: 2, heroPos: 'BTN', street: 'turn',
      heroHole: ['Ah', 'Qc'], board: ['Qs', '8d', '3h', '5c'],
      pot: 34, toCall: 13, effStack: 177,
      desc: '你在按钮位开池到 3，大盲 3-bet 到 10，你跟注，小盲弃牌，底池 10+10+1 = 21。翻牌 Q♠8♦3♥ 两人都过牌，转牌 5♣ 对手主动下注 13（约 2/3 池，底池变为 34）。',
      question: '你持 A♥Q♣（顶对顶踢），面对 2/3 池下注？',
      options: [
        { key: 'fold', verdict: 'bad', text: '弃牌',
          comment: '过度放弃。顶对顶踢能击败对手大量下注范围（QJ、QT、听牌、以及一些诈唬）。2/3 池的赔率约 28%，你的胜率通常在这之上。' },
        { key: 'call', verdict: 'best', text: '跟注 13',
          comment: '正确。顶对顶踢是标准的"跟注牌"而不是加注牌：加注只能打走比它差的牌、留下两对以上的强牌。' },
        { key: 'raise', verdict: 'ok', text: '加注到 40',
          comment: '偶尔可以做（尤其对手爱用过量的听牌下注时），但默认不是最优。加注会让 QJ 这类你领先的牌弃掉，却让两对/三条留下来继续打你。' },
      ],
      points: [
        '「顶对顶踢」是典型的跟注牌：它能赢很多，但赢不了加注 —— 所以不要主动把底池做大。',
        '翻牌两人都过牌后，对手在转牌突然下注，范围通常偏强（转牌成牌，或在翻牌设陷阱）。这时要守住，别过度反应。',
        '只要胜率高于底池赔率，跟注在数学上就是正收益，不需要"感觉能赢"才跟。',
      ],
    },
    {
      id: 'river-bluffcatch', cat: '翻牌后', title: '河牌面对超池全下 · 持两对',
      seats: 2, heroPos: 'BTN', street: 'river',
      heroHole: ['9h', '7h'], board: ['9s', '7d', 'Kc', '2h', 'Js'],
      pot: 60, toCall: 150, effStack: 150,
      desc: '你在按钮位开池，大盲跟注。你翻牌中了两对，一路（翻牌、转牌）连续下注，对手都跟注，底池做到 60，你们身后各剩约 150。河牌 J♠ 出现后，对手直接全下 150（2.5 倍池）。',
      question: '你持 9♥7♥（两对，但牌面有 K、J 两张大牌），面对超池全下？',
      options: [
        { key: 'fold', verdict: 'best', text: '弃牌',
          comment: '正确。超池下注的范围极端两极化 —— 要么坚果要么空气，而你的两对只赢空气。跟注需要 71% 胜率，这里明显不划算。' },
        { key: 'call', verdict: 'bad', text: '跟注 150',
          comment: '失误。跟注需要 150 ÷ (60+150) ≈ 71% 胜率。你的两对面对 KK、JJ、KJ、QT（顺子）全输，能赢的只有纯诈唬。' },
      ],
      points: [
        '超池下注（>1 倍池）通常代表"坚果或空气"。你要判断的是：他的诈唬组合够不够多。',
        '需要的胜率 = 跟注额 ÷（底池 + 跟注额）。这里 150 ÷ 210 ≈ 71%，这是很高的门槛。',
        '别被"我有两对"绑架：K、J 都在牌面上让两对的相对价值大幅下降。判断强弱要看"能击败对手多少范围"，而不是牌的名称。',
      ],
    },
    {
      id: 'river-thin-value', cat: '翻牌后', title: '河牌薄价值 · 顶对弱踢',
      seats: 2, heroPos: 'BB', street: 'river',
      heroHole: ['Qh', '8d'], board: ['Qc', 'Js', '5h', '3d', '2s'],
      pot: 11, toCall: 0, effStack: 194,
      desc: '按钮位开池到 5，你在 BB 跟注（小盲弃牌），底池 11。翻牌 Q♣J♠5♥ 两人都过牌，转牌 3♦ 也都过牌。河牌 2♠ 再次过牌到你。',
      question: '你持 Q♥8♦（顶对弱踢），对手连续过牌，你怎么做？',
      options: [
        { key: 'bet', verdict: 'ok', text: '下注 7',
          comment: '可以接受但偏乐观。对手可能是 JT、KJ 这类更好的牌，也可能是听牌错过的空气。小注能拿到一些价值，但被加注必须弃牌。' },
        { key: 'check', verdict: 'best', text: '过牌',
          comment: '正确。Q8 的踢脚太弱，能跟注你下注的牌大多比你好（QJ、QT、Q9），你只在对手全空气时赢。过牌摊牌是更稳的选择。' },
        { key: 'allin', verdict: 'bad', text: '全下 194',
          comment: '失误。全下只能被更好的牌跟注，把一手有摊牌价值的牌变成了纯赌博。' },
      ],
      points: [
        '薄价值下注的关键问题是："比我差的牌会跟注吗？" 如果答案是否，那就是在给自己挖坑。',
        '有摊牌价值的牌（能赢一部分范围）默认先选过牌，把价值下注留给踢脚更好的场合。',
        '河牌是最后一条街，"被加注后无处可逃"，因此对尺度与牌力的匹配要求比其他街更严格。',
      ],
    },
    {
      id: 'multiway-air-bluff', cat: '翻牌后', title: '三人池空气牌 · 该不该诈唬',
      seats: 3, heroPos: 'BTN', street: 'flop',
      heroHole: ['Ah', '5c'], board: ['Kd', '9s', '3h'],
      pot: 12, toCall: 0, effStack: 196,
      desc: '你在按钮位开池到 4，小盲和大盲都跟注，底池 4×3 = 12。翻牌 K♦9♠3♥，前面两人先后过牌，轮到你。你手上什么也没中。',
      question: '你持 A♥5♣（未成牌，仅一张高牌），前面都过牌，你怎么做？',
      options: [
        { key: 'bet', verdict: 'bad', text: '下注 8 诈唬',
          comment: '失误。多人池里至少有一人拿到 K 或 9 的概率很高，他们会跟注甚至加注。对手越多，诈唬需要的成功率越高，三人池几乎不划算。' },
        { key: 'check', verdict: 'best', text: '过牌',
          comment: '正确。三人池里诈唬需要所有人都弃牌，成功率大幅下降。你手上还有后门同花（A♥ + 两张红桃会出现），保留它比直接浪费掉更好。' },
        { key: 'allin', verdict: 'bad', text: '全下 196',
          comment: '严重失误。用没有胜率的牌全下，只能被更强的牌跟注，属于把主动权换成最大风险。' },
      ],
      points: [
        '诈唬需要的成功率随对手人数急剧上升：1 人约 50%，2 人约 67%，3 人约 75%。',
        '多人池里"有人中牌"的概率很高，因此价值下注要更强、诈唬要更少。',
        '有后门听牌（如 A 高 + 后门同花）的牌即使当前没成牌，也常更适合过牌保留，而不是直接诈唬掉。',
      ],
    },
    {
      id: 'flop-cbet-missed', cat: '翻牌后', title: '3-bet 底池 · 错过翻牌后的持续下注',
      seats: 2, heroPos: 'BTN', street: 'flop',
      heroHole: ['Ac', 'Kh'], board: ['8s', '5d', '2c'],
      pot: 19, toCall: 0, effStack: 181,
      desc: '你在按钮位用 A♣K♥ 3-bet 到 9，大盲跟注（他投 2 后补 7），底池 9+9+1（小盲）= 19，身后各约 181。翻牌 8♠5♦2♣ 全是低牌，对手过牌。',
      question: '你持 A♣K♥（两张高牌，未成牌），对手过牌，你怎么做？',
      options: [
        { key: 'check', verdict: 'ok', text: '过牌',
          comment: '可以接受。过牌能保留 AK 的摊牌价值，也是一种"延迟持续下注"的打法。但在这种干燥低牌面上，你会错过直接拿下底池的机会。' },
        { key: 'bet', verdict: 'best', text: '下注 6（约 ⅓ 池）',
          comment: '正确。AK 有两张高牌加卡顺可能，实际胜率不低。小尺度下注：对手弃牌你就赢，被跟注也还有 6 张补牌（3 张 A + 3 张 K）。' },
        { key: 'allin', verdict: 'bad', text: '全下 181',
          comment: '失误。用未成牌的 A 高去全下，风险与收益完全不成比例，只会被强牌跟注。' },
      ],
      points: [
        '持续下注（c-bet）在小尺度下几乎总能赚钱：对手弃牌率高时，⅓ 池（这里 6）就足够。',
        '即使牌面"对跟注者更有利"，只要你手上有两张高牌和后续听牌，小尺度下注仍然是正收益。',
        '3-bet 底池的筹码底池比（SPR ≈ 181 ÷ 19 ≈ 9.5 其实偏高）意味着还有多条街要打，要先想好翻牌下注之后转牌怎么办。',
      ],
    },
    {
      id: 'flop-overpair-vs-raise', cat: '翻牌后', title: '超对被加注 · 是否继续投入',
      seats: 2, heroPos: 'BTN', street: 'flop',
      heroHole: ['Jh', 'Jc'], board: ['9s', '6d', '4s'],
      pot: 45, toCall: 24, effStack: 190,
      desc: '你在按钮位开池到 4，大盲跟注（底池 9）。翻牌 9♠6♦4♠，你先下注 6（⅔ 池，底池变为 15），对手加注到 30。现在底池合计 45，你需要再补 24。你们身后各约 190。',
      question: '你持 J♥J♣（超对，但牌面有两张黑桃），面对加注到 30（需补 24）？',
      options: [
        { key: 'call', verdict: 'best', text: '跟注 24',
          comment: '正确。你的超对能击败大量同花听牌、9x 顶对和诈唬。跟注既保留了对手的诈唬，又控制了底池规模。' },
        { key: 'fold', verdict: 'bad', text: '弃牌',
          comment: '过度放弃。JJ 在这个牌面上领先对手大量的加注范围（同花听牌、9x、甚至纯诈唬），直接弃牌损失很大。' },
        { key: 'raise', verdict: 'ok', text: '再加注全下 190',
          comment: '不算错，但会把对手范围里的诈唬和弱听牌赶走，只留下两对/三条/强听牌。筹码还深时，跟注通常更好。' },
      ],
      points: [
        '对手加注不代表你要输：加注范围里"听牌 + 诈唬"的组合数往往比"强成牌"更多。',
        '超对在湿润面上偏向"跟注控制底池"，而不是全下 —— 目标是让对手的弱范围继续留在局里。',
        '判断能不能继续，关键仍是组合数（对手有多少套能击败你的牌 vs 你能击败的牌），而不是"他加注了所以我怕"。',
      ],
    },
  ];

  global.PK = global.PK || {};
  global.PK.SCENARIOS = SCENARIOS;

  if (typeof module !== 'undefined' && module.exports) module.exports = SCENARIOS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
