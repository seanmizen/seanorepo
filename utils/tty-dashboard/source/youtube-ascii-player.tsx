import React, {FC, useEffect, useState, useRef} from 'react';
import {Box, Text} from 'ink';
import ytdl from '@distube/ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import {Jimp} from 'jimp';
import * as fs from 'fs';
import * as path from 'path';
import {promisify} from 'util';

const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);

interface Props {
	searchQuery?: string;
	viewportWidth?: number;
	viewportHeight?: number;
	maxVideos?: number;
	millisecondsPerFrame?: number;
}

export const YouTubeAsciiPlayer: FC<Props> = ({
	searchQuery = 'family guy funny',
	viewportWidth = Math.round(16 * 1.5),
	viewportHeight = Math.round(9 * 1.5),
	maxVideos = 8,
	millisecondsPerFrame = 500,
}) => {
	const [status, setStatus] = useState<string>('Initializing...');
	const [frames, setFrames] = useState<string[]>([]);
	const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
	const [isPlaying, setIsPlaying] = useState<boolean>(false);
	const [error, setError] = useState<string | null>(null);
	const framesRef = useRef<string[]>([]);

	useEffect(() => {
		downloadAndProcessVideo();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Playback effect
	useEffect(() => {
		if (isPlaying && frames.length > 0) {
			const interval = setInterval(() => {
				setCurrentFrameIndex(prev => {
					if (prev >= frames.length - 1) {
						return 0; // Loop back to start
					}
					return prev + 1;
				});
			}, millisecondsPerFrame);

			return () => clearInterval(interval);
		}
		return undefined;
	}, [isPlaying, frames.length]);

	const downloadAndProcessVideo = async () => {
		try {
			const videosDir = path.join(process.cwd(), 'videos');
			await mkdir(videosDir, {recursive: true});

			// Check existing videos
			const existingVideos = await getExistingVideos(videosDir);

			if (existingVideos.length >= maxVideos) {
				// Use existing videos only - rotate through them
				setStatus(`Loading from cache (${existingVideos.length} videos)...`);
				const randomVideo =
					existingVideos[Math.floor(Math.random() * existingVideos.length)];
				if (randomVideo) {
					await loadCachedVideo(randomVideo);
				}
			} else {
				// Download new video
				setStatus('Searching YouTube...');
				const videoUrl = await searchYouTube(searchQuery || 'family guy funny');

				setStatus(
					`Downloading video (${existingVideos.length + 1}/${maxVideos})...`,
				);
				const videoPath = await downloadVideo(videoUrl, existingVideos.length);

				setStatus('Extracting frames...');
				const framePaths = await extractFrames(videoPath);

				setStatus('Converting to ASCII...');
				const asciiFrames = await convertFramesToAscii(
					framePaths,
					viewportWidth,
					viewportHeight,
				);

				setFrames(asciiFrames);
				framesRef.current = asciiFrames;
				setIsPlaying(true);
				setStatus(
					`Playing (${asciiFrames.length} frames) - ${
						existingVideos.length + 1
					}/${maxVideos} cached`,
				);

				// Cleanup frames but keep video
				await cleanupFrames(framePaths);
			}
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			setError(errorMsg);
			setStatus('Error occurred');
		}
	};

	const getExistingVideos = async (videosDir: string): Promise<string[]> => {
		try {
			const files = await readdir(videosDir);
			return files
				.filter(f => f.startsWith('video-') && f.endsWith('.mp4'))
				.map(f => path.join(videosDir, f));
		} catch {
			return [];
		}
	};

	const loadCachedVideo = async (videoPath: string) => {
		setStatus('Extracting frames...');
		const framePaths = await extractFrames(videoPath);

		setStatus('Converting to ASCII...');
		const asciiFrames = await convertFramesToAscii(
			framePaths,
			viewportWidth,
			viewportHeight,
		);

		setFrames(asciiFrames);
		framesRef.current = asciiFrames;
		setIsPlaying(true);
		setStatus(`Playing (${asciiFrames.length} frames) - from cache`);

		// Cleanup frames but keep video
		await cleanupFrames(framePaths);
	};

	const searchYouTube = async (_query: string): Promise<string> => {
		// For simplicity, we'll use a direct video URL
		// In production, you'd use YouTube Data API to search
		// For now, using a known Family Guy clip URL
		const videoId = 'dQw4w9WgXcQ'; // This is a placeholder - in reality you'd search

		// Alternative: hardcode a known Family Guy video
		// You can replace this with actual YouTube Data API search
		return `https://www.youtube.com/watch?v=${videoId}`;
	};

	const downloadVideo = async (
		videoUrl: string,
		videoIndex: number,
	): Promise<string> => {
		const videosDir = path.join(process.cwd(), 'videos');
		await mkdir(videosDir, {recursive: true});

		const tempPath = path.join(videosDir, `temp-${Date.now()}.mp4`);

		return new Promise((resolve, reject) => {
			const stream = ytdl(videoUrl, {
				quality: 'lowest',
				filter: 'videoandaudio',
			});

			const writeStream = fs.createWriteStream(tempPath);

			stream.pipe(writeStream);

			writeStream.on('finish', () => {
				// Trim to 30 seconds and save with index
				const finalPath = path.join(videosDir, `video-${videoIndex}.mp4`);

				ffmpeg(tempPath)
					.setStartTime(0)
					.setDuration(30)
					.output(finalPath)
					.on('end', () => {
						fs.unlinkSync(tempPath);
						resolve(finalPath);
					})
					.on('error', reject)
					.run();
			});

			writeStream.on('error', reject);
			stream.on('error', reject);
		});
	};

	const extractFrames = async (videoPath: string): Promise<string[]> => {
		const framesDir = path.join(process.cwd(), 'videos', 'frames');
		await mkdir(framesDir, {recursive: true});

		return new Promise((resolve, reject) => {
			ffmpeg(videoPath)
				.outputOptions([
					'-vf',
					'fps=10,scale=320:240', // Extract at 10 fps, scale down
				])
				.output(path.join(framesDir, 'frame-%04d.png'))
				.on('end', async () => {
					const files = await readdir(framesDir);
					const framePaths = files
						.filter(f => f.endsWith('.png'))
						.sort()
						.map(f => path.join(framesDir, f));
					resolve(framePaths);
				})
				.on('error', reject)
				.run();
		});
	};

	const convertFramesToAscii = async (
		framePaths: string[],
		width: number,
		height: number,
	): Promise<string[]> => {
		const asciiFrames: string[] = [];
		const asciiChars = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];

		for (let i = 0; i < framePaths.length; i++) {
			setStatus(`Converting frame ${i + 1}/${framePaths.length}...`);

			const framePath = framePaths[i];
			if (!framePath) continue;

			// Load image with Jimp
			const image = await Jimp.read(framePath);
			await image.resize({w: width, h: height});

			let ascii = '';
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					const color = image.getPixelColor(x, y);
					const r = (color >> 24) & 0xff;
					const g = (color >> 16) & 0xff;
					const b = (color >> 8) & 0xff;
					// Convert to grayscale
					const brightness = (r + g + b) / 3;
					const charIndex = Math.floor(
						(brightness / 255) * (asciiChars.length - 1),
					);
					ascii += asciiChars[charIndex];
				}
				ascii += '\n';
			}

			asciiFrames.push(ascii);
		}

		return asciiFrames;
	};

	const cleanupFrames = async (framePaths: string[]) => {
		try {
			// Delete frames only (keep videos)
			for (const framePath of framePaths) {
				if (fs.existsSync(framePath)) {
					await unlink(framePath);
				}
			}

			// Remove frames directory
			const firstFrame = framePaths[0];
			if (firstFrame) {
				const framesDir = path.dirname(firstFrame);
				if (fs.existsSync(framesDir)) {
					fs.rmdirSync(framesDir);
				}
			}
		} catch (err) {
			// Ignore cleanup errors
		}
	};

	if (error) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="red">Error: {error}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" padding={1}>
			<Text color="cyan">YouTube ASCII Player</Text>
			<Text dimColor>Status: {status}</Text>

			{isPlaying && frames.length > 0 && (
				<Box marginTop={1} borderStyle="single" paddingX={1}>
					<Text>{frames[currentFrameIndex]}</Text>
				</Box>
			)}

			{!isPlaying && frames.length === 0 && <Text dimColor>Loading...</Text>}

			{isPlaying && (
				<Text dimColor>
					Frame {currentFrameIndex + 1} / {frames.length}
				</Text>
			)}
		</Box>
	);
};
