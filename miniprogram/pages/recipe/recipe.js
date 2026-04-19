const app = getApp()
const recipeUtil = require('../../utils/recipe')

Page({
  data: {
    statusBarHeight: 0, headerRight: 0,
    recipes: []
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight, headerRight: app.globalData.capsulePaddingRight || 100 })
  },

  onShow() {
    this._loadRecipes()
  },

  _loadRecipes() {
    const recipes = recipeUtil.loadRecipes()
    const currentId = app.globalData.currentRecipeId || (recipes[0] && recipes[0].id)

    const list = recipes.map(r => ({
      id: r.id,
      name: r.name,
      ratio: r.ratio,
      stageCount: r.stages.length,
      stageLabels: r.stages.map(s => 'W' + (Number(s.weight) || 0).toFixed(0)),
      selected: r.id === currentId,
      isDefault: recipeUtil.isDefaultRecipe(r.id)
    }))

    this.setData({ recipes: list })
  },

  selectRecipe(e) {
    const id = e.currentTarget.dataset.id
    app.globalData.currentRecipeId = id
    wx.navigateBack()
  },

  editRecipe(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/recipe-edit/recipe-edit?id=' + id })
  },

  deleteRecipe(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '提示',
      content: '确定删除此方案？',
      success: (res) => {
        if (res.confirm) {
          let recipes = recipeUtil.loadRecipes()
          recipes = recipes.filter(r => r.id !== id)
          if (recipes.length === 0) recipes = recipeUtil.cloneDefaults()
          recipeUtil.saveRecipes(recipes)
          if (app.globalData.currentRecipeId === id) {
            app.globalData.currentRecipeId = recipes[0].id
          }
          this._loadRecipes()
        }
      }
    })
  },

  addRecipe() {
    wx.navigateTo({ url: '/pages/recipe-edit/recipe-edit' })
  },

  goBack() {
    wx.navigateBack()
  }
})
