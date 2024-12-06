import styles from './ThemeToggle.module.css';

function ThemeToggle({ mode, toggleMode }) {
  return (
    <div className={styles['theme-toggle-outer']}>
      <div className={styles['theme-toggle-inner']}>
        <button type="button" onClick={() => toggleMode()}>
          {`\xa0theme: ${mode}\xa0`.replace('system', 'auto')}
        </button>
      </div>
    </div>
  );
}

export default ThemeToggle;
