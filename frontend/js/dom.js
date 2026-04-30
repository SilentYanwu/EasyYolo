/**
 * DOM 元素统一引用管理
 */
export const dom = {
    // 顶部及全局
    topNavBtns: document.querySelectorAll('.top-nav-btn'),
    currentModelLabel: document.getElementById('currentModelName'),
    statusText: document.getElementById('statusText'),
    
    // 输入与核心控制
    imageInput: document.getElementById('imageInput'),
    videoInput: document.getElementById('videoInput'),
    predictBtn: document.getElementById('predictBtn'),
    downloadLink: document.getElementById('downloadLink'),
    
    // 展示区域
    originalImg: document.getElementById('originalImg'),
    resultImg: document.getElementById('resultImg'),
    originalVideo: document.getElementById('originalVideo'),
    resultVideo: document.getElementById('resultVideo'),
    playPauseBtn: document.getElementById('playPauseBtn'),
    
    // 列表容器
    rawList: document.getElementById('raw-model-list'),
    yoloList: document.getElementById('yolo-model-list'),
    inferenceTrainedList: document.getElementById('inference-trained-model-list'),
    trainedList: document.getElementById('trained-model-list'),
    historyGrid: document.getElementById('historyGrid'),
    
    // 弹窗相关
    uploadModal: document.getElementById('uploadModal'),
    renameModal: document.getElementById('renameModal'),
    deleteModal: document.getElementById('deleteModal'),
    clearHistoryModal: document.getElementById('clearHistoryModal'),
    deleteHistoryModal: document.getElementById('deleteHistoryModal'),
    messageModal: document.getElementById('messageModal'),
    messageModalTitle: document.getElementById('messageModalTitle'),
    messageModalText: document.getElementById('messageModalText'),
    messageModalConfirmBtn: document.getElementById('messageModalConfirmBtn'),
    messageModalCancelBtn: document.getElementById('messageModalCancelBtn'),
    messageModalNoBtn: document.getElementById('messageModalNoBtn'),
    renameInput: document.getElementById('renameInput'),
    oldNameHidden: document.getElementById('oldNameHidden'),
    categoryHidden: document.getElementById('categoryHidden'),
    deleteModelName: document.getElementById('deleteModelName'),
    deleteModelNameHidden: document.getElementById('deleteModelNameHidden'),
    deleteCategoryHidden: document.getElementById('deleteCategoryHidden'),
    deleteHistoryIdHidden: document.getElementById('deleteHistoryIdHidden'),
    
    // 进度与反馈
    batchProgress: document.getElementById('batchProgress'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    thumbnailPreview: document.getElementById('thumbnailPreview'),
    
    // 所有页面容器
    allContainers: document.querySelectorAll('.app-container'),

    // YOLO训练页面相关
    trainBaseModel: document.getElementById('trainBaseModel'),
    trainNewModelName: document.getElementById('trainNewModelName'),
    trainDatasetInput: document.getElementById('trainDatasetInput'),
    trainDatasetName: document.getElementById('trainDatasetName'),
    uploadDatasetBtn: document.getElementById('uploadDatasetBtn'),
    btnOpenTrainingParams: document.getElementById('btnOpenTrainingParams'),
    startTrainBtn: document.getElementById('startTrainBtn'),
    
    // 训练进度监控
    trainingDashboard: document.getElementById('trainingDashboard'),
    trainStatusLabel: document.getElementById('trainStatusLabel'),
    trainEtaLabel: document.getElementById('trainEtaLabel'),
    trainProgressFill: document.getElementById('trainProgressFill'),
    trainEpochLabel: document.getElementById('trainEpochLabel'),
    trainMetricsGrid: document.getElementById('trainMetricsGrid'),
    trainTaskTitle: document.getElementById('trainTaskTitle'),

    // 训练参数模态框
    trainingParamsModal: document.getElementById('trainingParamsModal'),

    // 模型详情页面相关
    detailsPlaceholder: document.getElementById('detailsPlaceholder'),
    detailsContent: document.getElementById('detailsContent'),
    detailsModelName: document.getElementById('detailsModelName'),
    detailsDatasetName: document.getElementById('detailsDatasetName'),
    detailsBaseModelLink: document.getElementById('detailsBaseModelLink'),
    detailsTrainingTime: document.getElementById('detailsTrainingTime'),
    detailsParamsTable: document.getElementById('detailsParamsTable'),
    detailsChartsGrid: document.getElementById('detailsChartsGrid'),
    detailsModelDescription: document.getElementById('detailsModelDescription'),
    detailsMenuTrigger: document.getElementById('detailsMenuTrigger'),
    detailsMenu: document.getElementById('detailsMenu'),
    detailsRenameBtn: document.getElementById('detailsRenameBtn'),
    detailsEditDescBtn: document.getElementById('detailsEditDescBtn'),
    detailsDeleteBtn: document.getElementById('detailsDeleteBtn'),
    editDescriptionModal: document.getElementById('editDescriptionModal'),
    editDescriptionInput: document.getElementById('editDescriptionInput'),
    descModelNameHidden: document.getElementById('descModelNameHidden'),

    // 最终训练指标面板
    finalMetricsSection: document.getElementById('finalMetricsSection'),
    detailsFinalMetricsGrid: document.getElementById('detailsFinalMetricsGrid')
};

/**
 * 重新获取那些动态变动的 DOM (如 NodeList)
 * 有些元素在初始化后可能会变，但这套系统大部分都是静态 ID
 */
export function getContainerById(id) {
    return document.getElementById(`page-${id}`);
}
