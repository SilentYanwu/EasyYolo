<script setup lang="ts">
import { ref } from 'vue'

const form = ref({
  modelName: '',
  dataset: '',
  epochs: 100,
  batchSize: 16,
  learningRate: 0.001,
  imageSize: 640,
  device: 'gpu'
})

const trainingStatus = ref<'idle' | 'training' | 'completed'>('idle')
const trainingProgress = ref(0)
const trainingLogs = ref<string[]>([])

const startTraining = async () => {
  if (!form.value.modelName || !form.value.dataset) {
    return
  }

  trainingStatus.value = 'training'
  trainingProgress.value = 0
  trainingLogs.value = ['开始训练...']

  try {
    // TODO: 调用后端API启动训练
    // const response = await axios.post('/api/train', form.value)

    // 模拟训练过程
    const interval = setInterval(() => {
      trainingProgress.value += 1
      if (trainingProgress.value % 10 === 0) {
        trainingLogs.value.push(`Epoch ${trainingProgress.value / 10}: loss=${(Math.random() * 0.5).toFixed(4)}`)
      }

      if (trainingProgress.value >= 100) {
        clearInterval(interval)
        trainingStatus.value = 'completed'
        trainingLogs.value.push('训练完成！')
      }
    }, 200)
  } catch (error) {
    console.error('训练失败:', error)
    trainingStatus.value = 'idle'
  }
}

const stopTraining = () => {
  trainingStatus.value = 'idle'
  trainingLogs.value.push('训练已停止')
}

const resetForm = () => {
  form.value = {
    modelName: '',
    dataset: '',
    epochs: 100,
    batchSize: 16,
    learningRate: 0.001,
    imageSize: 640,
    device: 'gpu'
  }
  trainingStatus.value = 'idle'
  trainingProgress.value = 0
  trainingLogs.value = []
}
</script>

<template>
  <div class="train-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>模型训练</span>
        </div>
      </template>

      <el-form :model="form" label-width="120px">
        <el-form-item label="模型名称">
          <el-input v-model="form.modelName" placeholder="请输入模型名称" />
        </el-form-item>

        <el-form-item label="数据集">
          <el-select v-model="form.dataset" placeholder="请选择数据集">
            <el-option label="COCO" value="coco" />
            <el-option label="VOC" value="voc" />
            <el-option label="自定义数据集" value="custom" />
          </el-select>
        </el-form-item>

        <el-form-item label="训练轮数">
          <el-input-number v-model="form.epochs" :min="1" :max="1000" />
        </el-form-item>

        <el-form-item label="批次大小">
          <el-input-number v-model="form.batchSize" :min="1" :max="128" />
        </el-form-item>

        <el-form-item label="学习率">
          <el-input-number v-model="form.learningRate" :min="0.0001" :max="1" :step="0.0001" :precision="4" />
        </el-form-item>

        <el-form-item label="图像尺寸">
          <el-select v-model="form.imageSize" placeholder="请选择图像尺寸">
            <el-option label="320" :value="320" />
            <el-option label="640" :value="640" />
            <el-option label="1280" :value="1280" />
          </el-select>
        </el-form-item>

        <el-form-item label="设备">
          <el-radio-group v-model="form.device">
            <el-radio label="gpu">GPU</el-radio>
            <el-radio label="cpu">CPU</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="startTraining" :disabled="trainingStatus === 'training'">
            开始训练
          </el-button>
          <el-button @click="stopTraining" :disabled="trainingStatus !== 'training'">
            停止训练
          </el-button>
          <el-button @click="resetForm" :disabled="trainingStatus === 'training'">
            重置
          </el-button>
        </el-form-item>
      </el-form>

      <div v-if="trainingStatus !== 'idle'" class="training-progress">
        <h3>训练进度</h3>
        <el-progress :percentage="trainingProgress" :status="trainingStatus === 'completed' ? 'success' : undefined" />

        <div class="training-logs">
          <div v-for="(log, index) in trainingLogs" :key="index" class="log-item">
            {{ log }}
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.train-container {
  max-width: 1200px;
  margin: 0 auto;
}

.card-header {
  font-size: 18px;
  font-weight: bold;
}

.training-progress {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #ebeef5;
}

.training-progress h3 {
  margin-bottom: 15px;
}

.training-logs {
  margin-top: 15px;
  max-height: 300px;
  overflow-y: auto;
  background-color: #f5f7fa;
  padding: 10px;
  border-radius: 4px;
}

.log-item {
  padding: 5px 0;
  border-bottom: 1px solid #ebeef5;
  font-family: monospace;
}
</style>
