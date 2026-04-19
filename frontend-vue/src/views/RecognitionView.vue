<script setup lang="ts">
import { ref } from 'vue'
import { UploadFilled } from '@element-plus/icons-vue'

const imageUrl = ref('')
const recognitionResult = ref<any>(null)
const loading = ref(false)

const handleFileChange = (uploadFile: any) => {
  imageUrl.value = URL.createObjectURL(uploadFile.raw)
}

const handleRecognition = async () => {
  if (!imageUrl.value) {
    return
  }

  loading.value = true
  try {
    // TODO: 调用后端API进行图像识别
    // const response = await axios.post('/api/recognition', { image: imageUrl.value })
    // recognitionResult.value = response.data

    // 模拟API调用
    setTimeout(() => {
      recognitionResult.value = {
        success: true,
        objects: [
          { name: 'person', confidence: 0.95, bbox: [100, 100, 200, 300] },
          { name: 'car', confidence: 0.88, bbox: [300, 200, 500, 400] }
        ]
      }
      loading.value = false
    }, 1000)
  } catch (error) {
    console.error('识别失败:', error)
    loading.value = false
  }
}
</script>

<template>
  <div class="recognition-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>模型识别</span>
        </div>
      </template>

      <el-upload
        class="upload-demo"
        drag
        action="#"
        :auto-upload="false"
        :on-change="handleFileChange"
        :show-file-list="false"
        accept="image/*"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">
          拖拽图片到此处或 <em>点击上传</em>
        </div>
      </el-upload>

      <div v-if="imageUrl" class="image-preview">
        <el-image :src="imageUrl" fit="contain" />
      </div>

      <div class="button-group">
        <el-button type="primary" @click="handleRecognition" :loading="loading">
          开始识别
        </el-button>
        <el-button @click="() => { imageUrl = ''; recognitionResult = null }">
          清除
        </el-button>
      </div>

      <div v-if="recognitionResult" class="result-container">
        <h3>识别结果</h3>
        <el-table :data="recognitionResult.objects" border>
          <el-table-column prop="name" label="类别" width="180" />
          <el-table-column prop="confidence" label="置信度" width="180">
            <template #default="scope">
              {{ (scope.row.confidence * 100).toFixed(2) }}%
            </template>
          </el-table-column>
          <el-table-column prop="bbox" label="边界框" />
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.recognition-container {
  max-width: 1200px;
  margin: 0 auto;
}

.card-header {
  font-size: 18px;
  font-weight: bold;
}

.upload-demo {
  margin-bottom: 20px;
}

.image-preview {
  margin: 20px 0;
  display: flex;
  justify-content: center;
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  padding: 10px;
  min-height: 200px;
}

.button-group {
  margin: 20px 0;
  display: flex;
  justify-content: center;
  gap: 10px;
}

.result-container {
  margin-top: 20px;
}

.result-container h3 {
  margin-bottom: 10px;
}
</style>
