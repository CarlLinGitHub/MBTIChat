const { questions, options, scoreQuiz } = require('../../lib/quiz')

function scrollToTop() {
  wx.pageScrollTo({ scrollTop: 0, duration: 0 })
}

Page({
  data: {
    options,
    total: questions.length,
    questionIndex: 0,
    question: questions[0].text,
    answer: null,
    result: null,
    tieChoices: {},
    chosenType: null,
  },

  onLoad() {
    this.answers = Array(questions.length).fill(null)
  },

  showQuestion(index) {
    this.setData({
      questionIndex: index,
      question: questions[index].text,
      answer: this.answers[index],
      result: null,
    }, scrollToTop)
  },

  chooseAnswer(event) {
    const { value } = event.currentTarget.dataset
    this.answers[this.data.questionIndex] = value
    this.setData({ answer: value })
  },

  previous() {
    const { questionIndex } = this.data
    if (questionIndex > 0) this.showQuestion(questionIndex - 1)
  },

  next() {
    const { questionIndex } = this.data
    if (this.answers[questionIndex] === null) return
    if (questionIndex < questions.length - 1) {
      this.showQuestion(questionIndex + 1)
      return
    }

    const result = scoreQuiz(this.answers)
    if (result) this.setData({ result, tieChoices: {}, chosenType: result.type }, scrollToTop)
  },

  choosePole(event) {
    const { axis, pole } = event.currentTarget.dataset
    const { result, tieChoices } = this.data
    const choices = { ...tieChoices, [axis]: pole }
    const letters = result.dimensions.map(dimension => dimension.letter || choices[dimension.key])
    this.setData({ tieChoices: choices, chosenType: letters.every(Boolean) ? letters.join('') : null })
  },

  editAnswers() {
    this.showQuestion(questions.length - 1)
  },

  retake() {
    this.answers.fill(null)
    this.showQuestion(0)
  },

  confirmResult() {
    const { chosenType } = this.data
    if (!chosenType) return
    const channel = this.getOpenerEventChannel()
    if (!channel || typeof channel.emit !== 'function') {
      wx.showToast({ title: '请从 MBTI 设置进入测验', icon: 'none' })
      return
    }
    channel.emit('quizResult', { type: chosenType })
    wx.navigateBack()
  },
})
