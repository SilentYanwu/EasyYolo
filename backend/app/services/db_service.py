import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, DateTime, desc
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

from backend.app.core.config import settings

# ---------------------------------------------------------
# 1. 数据库基础配置 (Engine & Session)
# ---------------------------------------------------------

# 数据库文件路径
DB_PATH = os.path.join(settings.BASE_DIR, "database", "yolo_app.db")
# 确保目录存在
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

# 创建 SQLAlchemy 引擎
# sqlite3 默认不支持多线程共享连接，check_same_thread=False 允许在 FastAPI 等异步/多线程环境中使用
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})

# 创建会话工厂
# autocommit=False: 开启事务，必须显式调用 commit()
# autoflush=False: 不在查询前自动把内存更改同步到数据库
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 创建模型基类
Base = declarative_base()

# ---------------------------------------------------------
# 2. ORM 模型定义 (Models)
# ---------------------------------------------------------

class InferenceHistory(Base):
    """推理历史记录模型"""
    __tablename__ = "inference_history"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    model_name = Column(String, nullable=False, index=True)
    original_url = Column(String)
    result_url = Column(String)
    # 使用 datetime.now 并在数据库中存储
    created_at = Column(DateTime, default=datetime.now)

class TrainingHistory(Base):
    """模型训练历史记录"""
    __tablename__ = "training_history"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    model_name = Column(String, unique=True, nullable=False, index=True) # 训练产生的文件名 (也是key)
    base_model = Column(String)                                          # 基础模型名
    dataset = Column(String)                                             # 数据集名称
    parameters = Column(String)                                          # 训练参数 (JSON 字符串)
    description = Column(String, default="")                              # 模型介绍
    final_metrics = Column(String, default="")                            # 训练完成时最终指标 (JSON 字符串)
    created_at = Column(DateTime, default=datetime.now)                  # 训练完成时间

# 自动创建表 (如果不存在)
Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------
# 3. 业务逻辑服务 (Service)
# ---------------------------------------------------------

class DBService:
    def __init__(self):
        pass

    def _get_db(self) -> Session:
        """获取一个新的数据库会话"""
        return SessionLocal()

    def _delete_physical_files(self, original_url, result_url):
        """删除硬盘上的物理文件 (保持原逻辑不变)"""
        try:
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
        db = self._get_db()
        try:
            # 1. 插入新记录
            new_record = InferenceHistory(
                model_name=model_name,
                original_url=original_url,
                result_url=result_url
            )
            db.add(new_record)
            db.commit() # 提交以确保新记录已分配 ID
            
            # 2. 检查记录数量，超出 99 条的部分需要清理
            # 这里的逻辑是：找出该模型下 ID 不在“最新的99条”之内的记录
            # 子查询：获取最新的 99 条记录的 ID
            latest_ids_subquery = db.query(InferenceHistory.id).\
                filter(InferenceHistory.model_name == model_name).\
                order_by(desc(InferenceHistory.id)).\
                limit(99).all()
            
            latest_ids = [r[0] for r in latest_ids_subquery]
            
            # 获取超过 99 条的旧记录
            old_records = db.query(InferenceHistory).\
                filter(InferenceHistory.model_name == model_name).\
                filter(~InferenceHistory.id.in_(latest_ids)).all()
            
            # 3. 删除物理文件并清理数据库
            if old_records:
                for rec in old_records:
                    self._delete_physical_files(rec.original_url, rec.result_url)
                    db.delete(rec)
                db.commit()
                
        except Exception as e:
            db.rollback() # 出错时回滚
            print(f"Error adding record: {e}")
        finally:
            db.close() # 必须关闭会话

    def delete_record(self, record_id):
        """删除单条记录及对应文件"""
        db = self._get_db()
        try:
            record = db.query(InferenceHistory).filter(InferenceHistory.id == record_id).first()
            if record:
                # 先删文件
                self._delete_physical_files(record.original_url, record.result_url)
                # 再删数据库记录
                db.delete(record)
                db.commit()
        except Exception as e:
            db.rollback()
            print(f"Error deleting record: {e}")
        finally:
            db.close()

    def get_history(self, model_name):
        """获取某模型的历史记录"""
        db = self._get_db()
        try:
            # 查询该模型的所有记录，按 ID 倒序排列
            records = db.query(InferenceHistory).\
                filter(InferenceHistory.model_name == model_name).\
                order_by(desc(InferenceHistory.id)).all()
            
            # 转换为字典列表，适配前端
            return [
                {
                    "id": r.id, 
                    "original": r.original_url, 
                    "result": r.result_url, 
                    "time": r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else ""
                } for r in records
            ]
        finally:
            db.close()

    def update_model_name(self, old_name, new_name):
        """更新模型名称 (批量更新)"""
        db = self._get_db()
        try:
            db.query(InferenceHistory).\
                filter(InferenceHistory.model_name == old_name).\
                update({"model_name": new_name})
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"Error updating model name: {e}")
        finally:
            db.close()

    def clear_history(self, model_name):
        """清空某模型所有记录及文件"""
        db = self._get_db()
        try:
            records = db.query(InferenceHistory).filter(InferenceHistory.model_name == model_name).all()
            for rec in records:
                self._delete_physical_files(rec.original_url, rec.result_url)
                db.delete(rec)
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"Error clearing history: {e}")
        finally:
            db.close()

    # --------------- 训练记录相关 -------------------

    def add_training_record(self, model_name: str, base_model: str, dataset: str, parameters: str, description: str = "", final_metrics: str = ""):
        """新增/更新一次训练历史入库"""
        db = self._get_db()
        try:
            # 检查是否已存在同名记录 (训练同名模型覆盖时更新)
            existing = db.query(TrainingHistory).filter(TrainingHistory.model_name == model_name).first()
            if existing:
                existing.base_model = base_model
                existing.dataset = dataset
                existing.parameters = parameters
                existing.description = description
                existing.final_metrics = final_metrics
                existing.created_at = datetime.now()
            else:
                new_record = TrainingHistory(
                    model_name=model_name,
                    base_model=base_model,
                    dataset=dataset,
                    parameters=parameters,
                    description=description,
                    final_metrics=final_metrics
                )
                db.add(new_record)
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"Error adding training record: {e}")
        finally:
            db.close()

    def get_training_record(self, model_name: str):
        """获取单个模型的训练记录详情"""
        db = self._get_db()
        try:
            record = db.query(TrainingHistory).filter(TrainingHistory.model_name == model_name).first()
            if record:
                return {
                    "model_name": record.model_name,
                    "base_model": record.base_model,
                    "dataset": record.dataset,
                    "parameters": record.parameters,
                    "description": record.description or "",
                    "final_metrics": record.final_metrics or "",
                    "time": record.created_at.strftime("%Y-%m-%d %H:%M:%S") if record.created_at else ""
                }
            return None
        finally:
            db.close()

    def delete_training_record(self, model_name: str):
        """级联删除一个模型的训练记录细节"""
        db = self._get_db()
        try:
            record = db.query(TrainingHistory).filter(TrainingHistory.model_name == model_name).first()
            if record:
                db.delete(record)
                db.commit()
        except Exception as e:
            db.rollback()
            print(f"Error clearing training history: {e}")
        finally:
            db.close()

    def update_training_record_name(self, old_name: str, new_name: str):
        """级联重命名一个模型的训练记录细节，及其作为基础模型的情况"""
        db = self._get_db()
        try:
            # 1. 更新该模型自身的记录名
            db.query(TrainingHistory).\
                filter(TrainingHistory.model_name == old_name).\
                update({"model_name": new_name})
            
            # 2. 更新其他记录中将其作为 base_model 的字段 (级联更新)
            db.query(TrainingHistory).\
                filter(TrainingHistory.base_model == old_name).\
                update({"base_model": new_name})
                
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"Error updating training record name: {e}")
        finally:
            db.close()

    def update_training_record_description(self, model_name: str, description: str):
        """更新模型介绍"""
        db = self._get_db()
        try:
            db.query(TrainingHistory).\
                filter(TrainingHistory.model_name == model_name).\
                update({"description": description})
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"Error updating description: {e}")
        finally:
            db.close()

# 导出单例
db_service = DBService()