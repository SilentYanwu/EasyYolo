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
    historyGrid: document.getElementById('historyGrid'),
    
    // 弹窗相关
    uploadModal: document.getElementById('uploadModal'),
    renameModal: document.getElementById('renameModal'),
    renameInput: document.getElementById('renameInput'),
    oldNameHidden: document.getElementById('oldNameHidden'),
    categoryHidden: document.getElementById('categoryHidden'),
    
    // 进度与反馈
    batchProgress: document.getElementById('batchProgress'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    thumbnailPreview: document.getElementById('thumbnailPreview'),
    
    // 所有页面容器
    allContainers: document.querySelectorAll('.app-container')
};

/**
 * 重新获取那些动态变动的 DOM (如 NodeList)
 * 有些元素在初始化后可能会变，但这套系统大部分都是静态 ID
 */
export function getContainerById(id) {
    return document.getElementById(`page-${id}`);
}
