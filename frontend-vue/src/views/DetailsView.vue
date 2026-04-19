<script setup lang="ts">
import { ref, onMounted } from 'vue'

const modelList = ref([
  {
    id: 1,
    name: 'yolov8n',
    accuracy: 0.85,
    size: '6.2MB',
    updateTime: '2024-01-15',
    status: 'available'
  },
  {
    id: 2,
    name: 'yolov8s',
    accuracy: 0.88,
    size: '21.5MB',
    updateTime: '2024-01-10',
    status: 'available'
  },
  {
    id: 3,
    name: 'yolov8m',
    accuracy: 0.91,
    size: '49.7MB',
    updateTime: '2024-01-05',
    status: 'available'
  }
])

const historyList = ref([
  {
    id: 1,
    type: 'recognition',
    modelName: 'yolov8n',
    result: '成功检测到5个目标',
    time: '2024-01-15 10:30:00'
  },
  {
    id: 2,
    type: 'training',
    modelName: 'custom_model',
    result: '训练完成，准确率92%',
    time: '2024-01-14 15:45:00'
  },
  {
    id: 3,
    type: 'recognition',
    modelName: 'yolov8s',
    result: '成功检测到8个目标',
    time: '2024-01-14 09:20:00'
  }
])

const activeTab = ref('models')

onMounted(() => {
  // TODO: 从后端API获取模型列表和历史记录
  // fetchModelList()
  // fetchHistoryList()
})
</script>

<template>
  <div class="details-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>详情页面</span>
        </div>
      </template>

      <el-tabs v-model="activeTab" type="border-card">
        <el-tab-pane label="模型列表" name="models">
          <el-table :data="modelList" border>
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="name" label="模型名称" width="180" />
            <el-table-column prop="accuracy" label="准确率" width="120">
              <template #default="scope">
                {{ (scope.row.accuracy * 100).toFixed(1) }}%
              </template>
            </el-table-column>
            <el-table-column prop="size" label="模型大小" width="120" />
            <el-table-column prop="updateTime" label="更新时间" width="180" />
            <el-table-column prop="status" label="状态" width="120">
              <template #default="scope">
                <el-tag :type="scope.row.status === 'available' ? 'success' : 'info'">
                  {{ scope.row.status === 'available' ? '可用' : '不可用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作">
              <template #default="scope">
                <el-button size="small" type="primary">使用</el-button>
                <el-button size="small" type="danger">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="历史记录" name="history">
          <el-timeline>
            <el-timeline-item
              v-for="item in historyList"
              :key="item.id"
              :timestamp="item.time"
              placement="top"
            >
              <el-card>
                <h4>{{ item.type === 'recognition' ? '图像识别' : '模型训练' }}</h4>
                <p>模型: {{ item.modelName }}</p>
                <p>结果: {{ item.result }}</p>
              </el-card>
            </el-timeline-item>
          </el-timeline>
        </el-tab-pane>

        <el-tab-pane label="系统信息" name="system">
          <el-descriptions title="系统信息" border :column="1">
            <el-descriptions-item label="系统版本">EasyYolo v1.0.0</el-descriptions-item>
            <el-descriptions-item label="Python版本">3.9.7</el-descriptions-item>
            <el-descriptions-item label="PyTorch版本">2.0.1</el-descriptions-item>
            <el-descriptions-item label="CUDA版本">11.8</el-descriptions-item>
            <el-descriptions-item label="GPU">NVIDIA RTX 3090</el-descriptions-item>
          </el-descriptions>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<style scoped>
.details-container {
  max-width: 1200px;
  margin: 0 auto;
}

.card-header {
  font-size: 18px;
  font-weight: bold;
}
</style>
