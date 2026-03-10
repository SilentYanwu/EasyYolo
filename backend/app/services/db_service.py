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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()
        conn.close()

    def add_record(self, model_name, original_url, result_url):
        """添加记录并保持每个模型最多99条"""
        conn = self._get_conn()
        cursor = conn.cursor()
        
        # 1. 插入新记录
        cursor.execute('''
            INSERT INTO inference_history (model_name, original_url, result_url)
            VALUES (?, ?, ?)
        ''', (model_name, original_url, result_url))
        
        # 2. 检查记录数量
        cursor.execute('SELECT count(*) FROM inference_history WHERE model_name = ?', (model_name,))
        count = cursor.fetchone()[0]
        
        # 3. 如果超过99条，删除最旧的
        if count > 99:
            # 找到该模型最旧的那些记录并删除（保留最新的99条）
            # SQLite删除逻辑：删除那些 不在（按时间倒序排列的前99条）里的ID
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

    def get_history(self, model_name):
        """获取某模型的历史记录"""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT original_url, result_url, created_at 
            FROM inference_history 
            WHERE model_name = ? 
            ORDER BY id DESC
        ''', (model_name,))
        rows = cursor.fetchall()
        conn.close()
        # 转为字典列表返回
        return [{"original": r[0], "result": r[1], "time": r[2]} for r in rows]

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
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM inference_history WHERE model_name = ?', (model_name,))
        conn.commit()
        conn.close()

db_service = DBService()