import { profileInitials, type Profile } from '@/domain/profile';

interface Props {
  profile: Profile;
  size?: number;
  className?: string;
}

/** 头像：有上传图就用图，否则用姓名首字；位置尺寸由外层控制 */
export default function ProfileAvatar({ profile, size = 40, className }: Props) {
  return (
    <span
      className={`profile-avatar${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) }}
      aria-hidden="true"
    >
      {profile.avatar ? <img src={profile.avatar} alt="" /> : <span>{profileInitials(profile)}</span>}
    </span>
  );
}
