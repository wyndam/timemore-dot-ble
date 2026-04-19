/**
 * 方案数据管理
 */

const STORAGE_KEY = 'brewRecipes'

const DEFAULT_RECIPES = [
  {
    id: 'three-stage',
    name: '标准三段式',
    ratio: '1:15',
    stages: [
      { weight: 3, targetFlow: 4, stopEarly: 4 },
      { weight: 8, targetFlow: 4, stopEarly: 4 },
      { weight: 7, targetFlow: 4, stopEarly: 4 }
    ]
  },
  {
    id: 'one-pour',
    name: '一刀流',
    ratio: '1:15',
    stages: [
      { weight: 18, targetFlow: 4, stopEarly: 4 }
    ]
  },
  {
    id: 'two-stage',
    name: '两段式',
    ratio: '1:15',
    stages: [
      { weight: 5, targetFlow: 4, stopEarly: 4 },
      { weight: 13, targetFlow: 4, stopEarly: 4 }
    ]
  }
]

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_RECIPES))
}

function parseRatioValue(ratioText) {
  if (typeof ratioText !== 'string') return 15
  const m = ratioText.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/)
  if (m) {
    const right = parseFloat(m[2])
    return right > 0 ? right : 15
  }
  const n = parseFloat(ratioText)
  return Number.isFinite(n) && n > 0 ? n : 15
}

function normalizeRecipe(recipe) {
  const ratioValue = parseRatioValue(recipe && recipe.ratio)
  const stagesRaw = Array.isArray(recipe && recipe.stages) ? recipe.stages : []
  const stages = stagesRaw.map((s, i) => {
    const w = parseFloat(s.weight)
    const weight = Number.isFinite(w) && w > 0 ? w : (i + 1)
    const targetFlow = Number.isFinite(parseFloat(s.targetFlow)) && parseFloat(s.targetFlow) > 0 ? parseFloat(s.targetFlow) : 4
    const stopEarly = Number.isFinite(parseFloat(s.stopEarly)) && parseFloat(s.stopEarly) >= 0 ? parseFloat(s.stopEarly) : 4
    return { weight, targetFlow, stopEarly }
  })
  return {
    id: recipe && recipe.id ? recipe.id : ('custom-' + Date.now()),
    name: recipe && recipe.name ? recipe.name : '自定义方案',
    ratio: '1:' + ratioValue,
    stages: stages.length > 0 ? stages : [{ weight: 1, targetFlow: 4, stopEarly: 4 }]
  }
}

function computeStageTargets(recipe, powderWeight) {
  if (!recipe || !Array.isArray(recipe.stages)) return []
  const pw = Math.max(0, Number(powderWeight) || 0)
  const ratio = parseRatioValue(recipe.ratio)
  const totalWater = pw * ratio
  const totalWeight = recipe.stages.reduce((sum, s) => sum + (Number(s.weight) || 0), 0) || 1
  return recipe.stages.map(s => totalWater * ((Number(s.weight) || 0) / totalWeight))
}

function getCumulativeTargets(targets) {
  const result = []
  let sum = 0
  ;(targets || []).forEach(v => {
    sum += Number(v) || 0
    result.push(sum)
  })
  return result
}

function isDefaultRecipe(id) {
  return DEFAULT_RECIPES.some(d => d.id === id)
}

// ---- 持久化 ----

function loadRecipes() {
  try {
    const saved = wx.getStorageSync(STORAGE_KEY)
    if (saved) {
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(r => normalizeRecipe(r))
      }
    }
  } catch (e) {}
  const defaults = cloneDefaults()
  saveRecipes(defaults)
  return defaults
}

function saveRecipes(recipes) {
  try {
    wx.setStorageSync(STORAGE_KEY, JSON.stringify(recipes))
  } catch (e) {
    console.error('Save recipes failed:', e)
  }
}

module.exports = {
  DEFAULT_RECIPES,
  cloneDefaults,
  parseRatioValue,
  normalizeRecipe,
  computeStageTargets,
  getCumulativeTargets,
  isDefaultRecipe,
  loadRecipes,
  saveRecipes
}
