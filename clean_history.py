import os
import shutil

def clear_target_folders():
    # 获取当前脚本所在目录
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 要清空的文件夹路径
    folders_to_clear = [
        os.path.join(base_dir, "backend", "inferecord", "results"),
        os.path.join(base_dir, "backend", "inferecord", "uploads"),
        os.path.join(base_dir, "database"),
        os.path.join(base_dir, "datasets"),
        os.path.join(base_dir, "backend", "trainchart"),
        os.path.join(base_dir, "runs"),
        os.path.join(base_dir, "models", "trained"),

    ]

    for folder_path in folders_to_clear:
        # 如果文件夹不存在，跳过
        if not os.path.isdir(folder_path):
            print(f"ℹ️ 文件夹不存在，跳过：{folder_path}")
            continue

        print(f"\n🗑️ 正在清空：{folder_path}")

        # 遍历删除里面所有内容
        for item in os.listdir(folder_path):
            item_path = os.path.join(folder_path, item)
            try:
                if os.path.isfile(item_path) or os.path.islink(item_path):
                    os.unlink(item_path)
                    print(f"已删除文件：{item}")
                elif os.path.isdir(item_path):
                    shutil.rmtree(item_path)
                    print(f"已删除目录：{item}")
            except Exception as e:
                print(f"❌ 删除失败 {item}：{str(e)}")

        print(f"✅ 完成清空：{folder_path}")

    print("\n🎉 所有目标文件夹已清空完成！")

if __name__ == "__main__":
    clear_target_folders()