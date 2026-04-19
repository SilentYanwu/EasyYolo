<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Menu, Picture, Document } from '@element-plus/icons-vue'

const router = useRouter()
const activeMenu = ref('/')

const handleSelect = (index: string) => {
  router.push(index)
}
</script>

<template>
  <el-container class="layout-container">
    <el-aside width="200px">
      <div class="logo">EasyYolo</div>
      <el-menu
        :default-active="activeMenu"
        class="el-menu-vertical"
        @select="handleSelect"
      >
        <el-menu-item index="/">
          <el-icon><Picture /></el-icon>
          <span>模型识别</span>
        </el-menu-item>
        <el-menu-item index="/train">
          <el-icon><Menu /></el-icon>
          <span>模型训练</span>
        </el-menu-item>
        <el-menu-item index="/details">
          <el-icon><Document /></el-icon>
          <span>详情页面</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header>
        <div class="header-title">EasyYolo 目标检测系统</div>
      </el-header>

      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout-container {
  height: 100vh;
}

.el-aside {
  background-color: #304156;
  color: #fff;
}

.logo {
  height: 60px;
  line-height: 60px;
  text-align: center;
  font-size: 20px;
  font-weight: bold;
  color: #fff;
  border-bottom: 1px solid #1f2d3d;
}

.el-menu {
  border-right: none;
}

.el-header {
  background-color: #fff;
  border-bottom: 1px solid #e6e6e6;
  display: flex;
  align-items: center;
  padding: 0 20px;
}

.header-title {
  font-size: 18px;
  font-weight: bold;
  color: #333;
}

.el-main {
  background-color: #f0f2f5;
  padding: 20px;
}
</style>
