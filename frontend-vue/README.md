# EasyYolo 前端项目

这是 EasyYolo 目标检测系统的前端项目，基于 Vue 3 + TypeScript + Element Plus + Vite 构建。

## 技术栈

- Vue 3 - 渐进式 JavaScript 框架
- TypeScript - JavaScript 的超集，添加了类型系统
- Vue Router - Vue 官方路由管理器
- Pinia - Vue 3 官方推荐的状态管理库
- Element Plus - 基于 Vue 3 的组件库
- Axios - HTTP 客户端
- Vite - 下一代前端构建工具

## 项目结构

```
frontend-vue/
├── src/
│   ├── views/           # 页面组件
│   │   ├── RecognitionView.vue   # 模型识别页面
│   │   ├── TrainView.vue         # 模型训练页面
│   │   └── DetailsView.vue       # 详情页面
│   ├── router/          # 路由配置
│   │   └── index.ts
│   ├── stores/          # 状态管理
│   │   └── counter.ts
│   ├── App.vue          # 根组件
│   └── main.ts          # 入口文件
├── public/              # 静态资源
├── package.json         # 项目依赖
└── vite.config.ts       # Vite 配置
```

## 安装依赖

```bash
npm install
```

## 开发模式运行

```bash
npm run dev
```

## 生产构建

```bash
npm run build
```

## 预览生产构建

```bash
npm run preview
```

## 功能说明

### 模型识别
- 上传图片进行目标检测
- 显示识别结果，包括类别、置信度和边界框
- 支持清除上传的图片和识别结果

### 模型训练
- 配置训练参数（模型名称、数据集、训练轮数等）
- 实时显示训练进度
- 显示训练日志

### 详情页面
- 查看已训练的模型列表
- 查看历史操作记录
- 查看系统信息

## 注意事项

1. 当前版本使用模拟数据，需要连接后端API才能实现完整功能
2. 后端API地址需要在 axios 配置中设置
3. 部分功能（如模型训练、图像识别）需要后端支持

## 后续开发计划

- [ ] 连接后端API
- [ ] 实现用户认证
- [ ] 添加数据可视化
- [ ] 优化性能和用户体验
- [ ] 添加单元测试
