const axes = [
  { key: 'EI', label: '精力来源', poles: [
    { letter: 'E', label: '从互动中充电' }, { letter: 'I', label: '从独处中充电' },
  ] },
  { key: 'SN', label: '接收信息', poles: [
    { letter: 'S', label: '关注事实和细节' }, { letter: 'N', label: '关注联系和可能' },
  ] },
  { key: 'TF', label: '做决定时', poles: [
    { letter: 'T', label: '优先权衡理由' }, { letter: 'F', label: '优先考虑人的感受' },
  ] },
  { key: 'JP', label: '安排生活', poles: [
    { letter: 'J', label: '喜欢提前定计划' }, { letter: 'P', label: '喜欢保留灵活性' },
  ] },
]

const questions = [
  { axis: 'EI', pole: 'E', text: '平常有空时，和朋友见面聊聊往往会让我更有精神。' },
  { axis: 'SN', pole: 'S', text: '学一项新技能时，比起先弄懂背后的原理，我更想看一个具体的操作示例。' },
  { axis: 'TF', pole: 'F', text: '同事问我对一份作品的看法时，我会先想对方怎么听更容易接受。' },
  { axis: 'JP', pole: 'J', text: '出去玩之前，把大致的时间和路线安排好会让我更自在。' },
  { axis: 'TF', pole: 'T', text: '遇到意见分歧时，我习惯先找出双方能用来比较方案的同一套标准。' },
  { axis: 'EI', pole: 'I', text: '忙过一阵之后，我更愿意留出一点独处时间来恢复精力。' },
  { axis: 'JP', pole: 'P', text: '如果几个方案都可行，我通常愿意先保留选项，等时机更合适再定。' },
  { axis: 'SN', pole: 'N', text: '接触一个新点子时，我常常会联想到它在其他场景里的用途。' },
  { axis: 'JP', pole: 'J', text: '面对几件都要完成的事，我喜欢先排好顺序再开始。' },
  { axis: 'TF', pole: 'F', text: '给共同活动定规则时，我会先考虑规则对参与者的实际感受有什么影响。' },
  { axis: 'SN', pole: 'S', text: '回忆一段经历时，我比较容易想起当时看见的东西和事情发生的顺序。' },
  { axis: 'EI', pole: 'E', text: '想法还没成形时，我常在和别人聊的过程中把思路理清。' },
  { axis: 'SN', pole: 'N', text: '看完一个故事后，我常会琢磨它没明说的含义。' },
  { axis: 'EI', pole: 'I', text: '在陌生的小组里，我通常喜欢先听一会儿，再加入讨论。' },
  { axis: 'JP', pole: 'P', text: '准备一顿随意的晚餐时，我喜欢根据手边的食材临时决定做什么。' },
  { axis: 'TF', pole: 'T', text: '朋友找我商量两难的选择时，我下意识会先帮对方梳理各方案的利弊。' },
  { axis: 'EI', pole: 'I', text: '有半天完全空闲时，我通常更想自己做喜欢的事，而不是约人一起度过。' },
  { axis: 'TF', pole: 'T', text: '在几项建议中选一个时，即使建议来自熟悉的人，我也倾向用同样的标准来比较。' },
  { axis: 'SN', pole: 'S', text: '听别人介绍一个提案时，我最先想知道它具体要做什么、如何执行。' },
  { axis: 'JP', pole: 'P', text: '一个项目刚开始时，我更愿意边尝试边调整，而不是先定好完整的步骤。' },
  { axis: 'TF', pole: 'F', text: '团队要在两个都可行的方案里选一个时，我会特别留意哪个更照顾成员的处境。' },
  { axis: 'JP', pole: 'J', text: '即使截止日期还很远，我也喜欢提前决定什么时候开始、什么时候收尾。' },
  { axis: 'EI', pole: 'E', text: '遇到一件有趣的事时，我通常想尽快找人分享和交流。' },
  { axis: 'SN', pole: 'N', text: '看到几个新变化时，我常会想它们是不是指向某种共同趋势。' },
]

const options = [
  { value: 2, label: '非常同意' },
  { value: 1, label: '比较同意' },
  { value: 0, label: '不确定' },
  { value: -1, label: '比较不同意' },
  { value: -2, label: '非常不同意' },
]

function scoreQuiz(answers) {
  if (!Array.isArray(answers) || answers.length !== questions.length) return null

  const scores = { EI: 0, SN: 0, TF: 0, JP: 0 }
  for (let index = 0; index < questions.length; index += 1) {
    const answer = answers[index]
    if (!Number.isInteger(answer) || answer < -2 || answer > 2) return null
    const { axis, pole } = questions[index]
    scores[axis] += pole === axis[0] ? answer : -answer
  }

  const dimensions = axes.map(axis => {
    const score = scores[axis.key]
    const letter = score === 0 ? null : axis.poles[score > 0 ? 0 : 1].letter
    return { ...axis, score, letter }
  })
  const type = dimensions.every(dimension => dimension.letter) ? dimensions.map(dimension => dimension.letter).join('') : null
  return { dimensions, type }
}

module.exports = { questions, options, scoreQuiz }
