const app = getApp()
const recipeUtil = require('../../utils/recipe')

Page({
  data: {
    statusBarHeight: 0, headerRight: 0,
    title: '新建方案',
    name: '',
    ratio: '1:15',
    stages: [{ weight: '1', targetFlow: '4', stopEarly: '4' }],
    showDelete: false
  },

  _editingId: null,

  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight, headerRight: app.globalData.capsulePaddingRight || 100 })

    if (options.id) {
      this._editingId = options.id
      const recipes = recipeUtil.loadRecipes()
      const recipe = recipes.find(r => r.id === options.id)
      if (recipe) {
        this.setData({
          title: '编辑方案',
          name: recipe.name,
          ratio: '1:' + recipeUtil.parseRatioValue(recipe.ratio),
          stages: recipe.stages.map(s => ({
            weight: String(s.weight || 1),
            targetFlow: String(s.targetFlow || 4),
            stopEarly: String(s.stopEarly || 4)
          })),
          showDelete: !recipeUtil.isDefaultRecipe(options.id)
        })
      }
    }
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },

  onRatioInput(e) {
    this.setData({ ratio: e.detail.value })
  },

  onStageInput(e) {
    const { index, field } = e.currentTarget.dataset
    const key = 'stages[' + index + '].' + field
    this.setData({ [key]: e.detail.value })
  },

  addStage() {
    const stages = this.data.stages.concat([{ weight: '1', targetFlow: '4', stopEarly: '4' }])
    this.setData({ stages })
  },

  removeStage(e) {
    const index = e.currentTarget.dataset.index
    const stages = this.data.stages.filter((_, i) => i !== index)
    this.setData({ stages })
  },

  saveRecipe() {
    const name = this.data.name.trim()
    const ratioValue = recipeUtil.parseRatioValue(this.data.ratio)
    const stages = this.data.stages.map(s => ({
      weight: parseFloat(s.weight) || 1,
      targetFlow: parseFloat(s.targetFlow) || 4,
      stopEarly: parseFloat(s.stopEarly) || 4
    }))

    if (!name) {
      wx.showToast({ title: '请输入方案名称', icon: 'none' })
      return
    }
    if (!stages.length) {
      wx.showToast({ title: '请至少保留一个注水阶段', icon: 'none' })
      return
    }
    if (ratioValue <= 0 || stages.some(s => s.weight <= 0 || s.targetFlow <= 0 || s.stopEarly < 0)) {
      wx.showToast({ title: '请填写有效的方案参数', icon: 'none' })
      return
    }

    let recipes = recipeUtil.loadRecipes()

    if (this._editingId) {
      const index = recipes.findIndex(r => r.id === this._editingId)
      if (index >= 0) {
        recipes[index] = recipeUtil.normalizeRecipe({
          ...recipes[index],
          name,
          ratio: '1:' + ratioValue,
          stages
        })
      }
    } else {
      recipes.push(recipeUtil.normalizeRecipe({
        id: 'custom-' + Date.now(),
        name,
        ratio: '1:' + ratioValue,
        stages
      }))
    }

    recipeUtil.saveRecipes(recipes)
    wx.navigateBack()
  },

  deleteRecipe() {
    if (!this._editingId) return
    wx.showModal({
      title: '提示',
      content: '确定删除此方案？',
      success: (res) => {
        if (res.confirm) {
          let recipes = recipeUtil.loadRecipes()
          recipes = recipes.filter(r => r.id !== this._editingId)
          if (recipes.length === 0) recipes = recipeUtil.cloneDefaults()
          recipeUtil.saveRecipes(recipes)
          if (app.globalData.currentRecipeId === this._editingId) {
            app.globalData.currentRecipeId = recipes[0].id
          }
          wx.navigateBack()
        }
      }
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
