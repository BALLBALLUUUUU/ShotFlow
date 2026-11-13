import { useEffect, useRef, useState } from 'react';
import { Bell, CalendarDays, Camera, Check, Trash2, UserRound, X } from 'lucide-react';
import AvailabilityCalendar from '@/components/AvailabilityCalendar';
import ProfileAvatar from '@/components/ProfileAvatar';
import {
  MAX_LEAD_HOURS,
  MIN_LEAD_HOURS,
  PROFILE_ROLE_OPTIONS,
  REMINDER_PRESETS,
  cycleAvailability,
  profileSignature,
  type ProfileAvailability,
  type ProfileReminder,
} from '@/domain/profile';
import { saveProfile, useProfile } from '@/store/profileStore';

interface Props {
  onClose: () => void;
  onToast?: (message: string) => void;
  /** 项目里真实的拍摄日，日历上打点提示 */
  shootDates?: string[];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读取失败'));
    image.src = src;
  });
}

/** 居中裁成方形再压到 256×256 JPEG，避免 localStorage 被大图撑爆 */
async function shrinkAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error('图片尺寸异常');
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理这张图片');
    // 透明 PNG 转 JPEG 会变黑，先铺白底
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 256, 256);
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ProfileSettings({ onClose, onToast, shootDates = [] }: Props) {
  const saved = useProfile();
  const [avatar, setAvatar] = useState(saved.avatar);
  const [name, setName] = useState(saved.name);
  const [role, setRole] = useState(saved.role);
  const [availability, setAvailability] = useState<ProfileAvailability[]>(saved.availability);
  const [reminder, setReminder] = useState<ProfileReminder>(saved.reminder);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const draft = { ...saved, avatar, name: name.trim(), role: role.trim() };
  const signature = profileSignature(draft);

  function toggleDate(date: string) {
    setAvailability(cycleAvailability({ ...saved, availability }, date).availability);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError('头像请用 PNG / JPEG / WebP 图片');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('头像请小于 8MB');
      return;
    }
    try {
      setAvatar(await shrinkAvatar(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '头像处理失败');
    }
  }

  function handleSave() {
    const next = saveProfile({
      ...saved,
      avatar,
      name,
      role,
      availability,
      reminder: {
        enabled: reminder.enabled,
        leadHours: Math.min(MAX_LEAD_HOURS, Math.max(MIN_LEAD_HOURS, Math.round(reminder.leadHours) || 24)),
      },
    });
    onToast?.(next.name ? `个人设置已保存：${profileSignature(next)}` : '个人设置已保存');
    onClose();
  }

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="drawer profile-drawer" role="dialog" aria-modal="true" aria-label="个人设置">
        <div className="drawer-head">
          <div>
            <h2><UserRound size={17} />个人设置</h2>
            <p className="drawer-sub">头像、署名、档期与拍摄提醒，只保存在本机</p>
          </div>
          <button className="icon-btn" type="button" aria-label="关闭" onClick={onClose}><X size={17} /></button>
        </div>

        <div className="drawer-body">
          {error ? <div className="library-error" role="alert">{error}</div> : null}

          <section className="drawer-section">
            <h3 className="drawer-title">头像</h3>
            <div className="avatar-row">
              <ProfileAvatar profile={draft} size={68} />
              <div className="avatar-actions">
                <div className="avatar-buttons">
                  <button className="btn ghost compact" type="button" onClick={() => fileRef.current?.click()}>
                    <Camera size={13} />上传头像
                  </button>
                  {avatar ? (
                    <button className="btn ghost compact" type="button" onClick={() => setAvatar('')}>
                      <Trash2 size={13} />移除
                    </button>
                  ) : null}
                </div>
                <p className="drawer-hint">方形居中裁切后保存，不上传云端。没设头像时显示姓名首字。</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  aria-label="选择头像图片"
                  onChange={(event) => {
                    void handleFile(event.currentTarget.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                />
              </div>
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-title">署名</h3>
            <div className="profile-fields">
              <label className="profile-field">
                <span>名称</span>
                <input
                  className="text-input"
                  value={name}
                  maxLength={40}
                  placeholder="导出时印在片头的姓名"
                  onChange={(event) => setName(event.currentTarget.value)}
                />
              </label>
              <label className="profile-field">
                <span>职务</span>
                <input
                  className="text-input"
                  value={role}
                  maxLength={30}
                  list="profile-role-options"
                  placeholder="如 导演 / 摄影指导"
                  onChange={(event) => setRole(event.currentTarget.value)}
                />
                <datalist id="profile-role-options">
                  {PROFILE_ROLE_OPTIONS.map((option) => <option value={option} key={option} />)}
                </datalist>
              </label>
            </div>
            <div className="role-chips">
              {['导演', '制片', '摄影指导', '摄影师', '灯光', '录音', '美术', '场记'].map((option) => (
                <button
                  key={option}
                  className={role.trim() === option ? 'role-chip active' : 'role-chip'}
                  type="button"
                  onClick={() => setRole(option)}
                >{option}</button>
              ))}
            </div>
            <p className="profile-sign-hint">
              {name.trim()
                ? <>导出分镜与 Rundown 时会自动填入片头：<b>{signature}</b>（项目里已填的署名不会被覆盖）</>
                : '填了名称后，导出分镜与 Rundown 会自动补上职务和姓名。'}
            </p>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-title"><CalendarDays size={14} />日历档期</h3>
            <p className="drawer-hint">点日期循环切换：有档期 → 已排期 → 清空。橙色点为项目里的拍摄日。</p>
            <AvailabilityCalendar
              profile={{ ...saved, availability }}
              month={month}
              onMonthChange={setMonth}
              onToggleDate={toggleDate}
              shootDates={shootDates}
            />
            <div className="cal-actions">
              <span>{availability.length} 天已标注</span>
              <button
                className="btn ghost compact"
                type="button"
                disabled={availability.length === 0}
                onClick={() => setAvailability([])}
              >清空档期</button>
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-title"><Bell size={14} />拍摄提醒</h3>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={reminder.enabled}
                onChange={(event) => {
                  const enabled = event.currentTarget.checked;
                  setReminder((previous) => ({ ...previous, enabled }));
                }}
              />
              <span>开启拍摄提醒</span>
            </label>
            <div className="reminder-lead">
              <span>在拍摄日前</span>
              <input
                className="text-input num"
                type="number"
                min={MIN_LEAD_HOURS}
                max={MAX_LEAD_HOURS}
                value={reminder.leadHours}
                disabled={!reminder.enabled}
                onChange={(event) => {
                  const leadHours = Number(event.currentTarget.value);
                  setReminder((previous) => ({ ...previous, leadHours: Number.isFinite(leadHours) ? leadHours : 24 }));
                }}
              />
              <span>小时提醒我</span>
            </div>
            <div className="reminder-chips">
              {REMINDER_PRESETS.map((hours) => (
                <button
                  key={hours}
                  className={reminder.leadHours === hours ? 'role-chip active' : 'role-chip'}
                  type="button"
                  disabled={!reminder.enabled}
                  onClick={() => setReminder({ enabled: true, leadHours: hours })}
                >{hours < 24 ? `${hours} 小时` : `${hours / 24} 天`}</button>
              ))}
            </div>
            <p className="drawer-hint">到窗口期时，项目库顶部会出现提醒条，启动软件也会提示一次。只是本机提示，不会推送到手机。</p>
          </section>
        </div>

        <div className="drawer-foot">
          <span className="drawer-foot-hint">{saved.name ? `当前：${saved.name}` : '还没有设置个人资料'}</span>
          <div>
            <button className="btn ghost" type="button" onClick={onClose}>取消</button>
            <button className="btn primary" type="button" onClick={handleSave}><Check size={15} />保存</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
