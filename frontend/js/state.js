/**
 * 全局应用状态管理
 */
export const state = {
    currentModelName: "",
    currentCategory: "",
    currentDetailsModelName: "", // 当前在详情页查看的模型名
    activeMenuId: null,         // 当前展开的上下文菜单ID
    lastTrainingStatus: "idle", // 上次记录的训练状态，用于检测状态切换
    
    // 侧边栏状态：从本地存储读取
    get isSidebarCollapsed() {
        return localStorage.getItem('sidebarCollapsed') === 'true';
    },
    set isSidebarCollapsed(value) {
        localStorage.setItem('sidebarCollapsed', value);
    }
};
