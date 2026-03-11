import sqlite3
import os
from datetime import datetime
from core.config import settings

DB_PATH = os.path.join(settings.BASE_DIR, "database", "yolo_app.db")

# 确保 database 目录存在
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

class DBService:
    def __init__(self):
        self._init_db()

    def _get_conn(self):
        return sqlite3.connect(DB_PATH, check_same_thread=False)

    def _init_db(self):
        """初始化数据库表"""
        conn = self._get_conn()
        cursor = conn.cursor()
        # 创建历史记录表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS inference_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model_name TEXT NOT NULL,
                original_url TEXT,
                result_url TEXT,
                created_at TIMESTAMP DEFAULT (datetime('now', 'localtime'))
            )
        ''')
        conn.commit()
        conn.close()

    def _delete_physical_files(self, original_url, result_url):
        """删除硬盘上的物理文件"""
        try:
            # 从 URL 中提取文件名
            if original_url:
                ori_name = original_url.split("/")[-1]
                ori_path = os.path.join(settings.UPLOAD_DIR, ori_name)
                if os.path.exists(ori_path):
                    os.remove(ori_path)
            
            if result_url:
                res_name = result_url.split("/")[-1]
                res_path = os.path.join(settings.RESULT_DIR, res_name)
                if os.path.exists(res_path):
                    os.remove(res_path)
        except Exception as e:
            print(f"Error deleting files: {e}")

    def add_record(self, model_name, original_url, result_url):
        """添加记录并保持每个模型最多99条"""
        conn = self._get_conn()
        cursor = conn.cursor()
        
        # 1. 插入新记录
        cursor.execute('''
            INSERT INTO inference_history (model_name, original_url, result_url)
            VALUES (?, ?, ?)
        ''', (model_name, original_url, result_url))
        
        # 2. 检查记录数量并获取要删除的旧记录的文件路径
        cursor.execute('''
            SELECT original_url, result_url FROM inference_history 
            WHERE model_name = ? AND id NOT IN (
                SELECT id FROM inference_history 
                WHERE model_name = ? 
                ORDER BY id DESC 
                LIMIT 99
            )
        ''', (model_name, model_name))
        old_files = cursor.fetchall()
        
        # 3. 如果超过99条，删除物理文件并清理数据库
        if old_files:
            for ori_u, res_u in old_files:
                self._delete_physical_files(ori_u, res_u)

            cursor.execute('''
                DELETE FROM inference_history 
                WHERE id NOT IN (
                    SELECT id FROM inference_history 
                    WHERE model_name = ? 
                    ORDER BY id DESC 
                    LIMIT 99
                ) AND model_name = ?
            ''', (model_name, model_name))
            
        conn.commit()
        conn.close()

    def delete_record(self, record_id):
        """删除单条记录及对应文件"""
        conn = self._get_conn()
        cursor = conn.cursor()
        
        # 获取文件路径
        cursor.execute("SELECT original_url, result_url FROM inference_history WHERE id = ?", (record_id,))
        row = cursor.fetchone()
        
        if row:
            self._delete_physical_files(row[0], row[1])
            cursor.execute("DELETE FROM inference_history WHERE id = ?", (record_id,))
            conn.commit()
        
        conn.close()

    def get_history(self, model_name):
        """获取某模型的历史记录"""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, original_url, result_url, created_at 
            FROM inference_history 
            WHERE model_name = ? 
            ORDER BY id DESC
        ''', (model_name,))
        rows = cursor.fetchall()
        conn.close()
        # 转为字典列表返回
        return [{"id": r[0], "original": r[1], "result": r[2], "time": r[3]} for r in rows]

    def update_model_name(self, old_name, new_name):
        """更新模型名称"""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE inference_history 
            SET model_name = ? 
            WHERE model_name = ?
        ''', (new_name, old_name))
        conn.commit()
        conn.close()

    def clear_history(self, model_name):
        """清空某模型所有记录及文件"""
        conn = self._get_conn()
        cursor = conn.cursor()
        
        # 获取所有文件
        cursor.execute("SELECT original_url, result_url FROM inference_history WHERE model_name = ?", (model_name,))
        rows = cursor.fetchall()
        for r in rows:
            self._delete_physical_files(r[0], r[1])
            
        cursor.execute('DELETE FROM inference_history WHERE model_name = ?', (model_name,))
        conn.commit()
        conn.close()

db_service = DBService()