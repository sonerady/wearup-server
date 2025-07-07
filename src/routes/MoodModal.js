import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

const { width: screenWidth } = Dimensions.get("window");
const cardWidth = (screenWidth - 60) / 3; // 3 sütun, padding ve gap için

const MoodModal = ({
  isVisible,
  onClose,
  onMoodSelect,
  preSelectedMood = null,
}) => {
  const { t } = useTranslation();

  // Mood verisi - name'ler artık i18n key'leri
  const moodData = [
    {
      id: "smile",
      name: "smile",
      emoji: "😊",
      color: "#F59E0B",
      isPopular: true,
    },
    {
      id: "natural",
      name: "natural",
      emoji: "😌",
      color: "#8B5CF6",
      isPopular: true,
    },
    { id: "angry", name: "angry", emoji: "😠", color: "#EF4444" },
    { id: "playful", name: "playful", emoji: "😜", color: "#EC4899" },
    { id: "confident", name: "confident", emoji: "😎", color: "#10B981" },
    { id: "nervous", name: "nervous", emoji: "😬", color: "#F97316" },
    { id: "surprised", name: "surprised", emoji: "😮", color: "#06B6D4" },
    { id: "anxious", name: "anxious", emoji: "😰", color: "#6366F1" },
    { id: "optimistic", name: "optimistic", emoji: "🌞", color: "#84CC16" },
    { id: "curious", name: "curious", emoji: "🧐", color: "#D946EF" },
    { id: "determined", name: "determined", emoji: "😤", color: "#EF4444" },
    { id: "relaxed", name: "relaxed", emoji: "🌴", color: "#14B8A6" },
    { id: "passionate", name: "passionate", emoji: "🔥", color: "#F59E0B" },
    { id: "hopeful", name: "hopeful", emoji: "🌈", color: "#8B5CF6" },
    { id: "lonely", name: "lonely", emoji: "😔", color: "#6B7280" },
    { id: "inspired", name: "inspired", emoji: "💡", color: "#F59E0B" },
    { id: "fearful", name: "fearful", emoji: "😨", color: "#6366F1" },
    { id: "grateful", name: "grateful", emoji: "🙏", color: "#10B981" },
    { id: "bored", name: "bored", emoji: "😒", color: "#6B7280" },
    { id: "creative", name: "creative", emoji: "🎨", color: "#EC4899" },
    { id: "sleepy", name: "sleepy", emoji: "😴", color: "#8B5CF6" },
  ];

  // Default olarak smile mood'unu seç
  const defaultSmileMood = moodData[0]; // smile mood
  const [selectedMood, setSelectedMood] = useState(
    preSelectedMood || defaultSmileMood
  );

  // Modal açıldığında seçili mood'u güncelle
  useEffect(() => {
    if (isVisible) {
      setSelectedMood(preSelectedMood || defaultSmileMood);
    }
  }, [isVisible, preSelectedMood]);

  // Mood seçimi
  const handleMoodSelect = (mood) => {
    setSelectedMood(mood);

    if (onMoodSelect) {
      onMoodSelect(mood);
    }

    // Modal'ı kapatmadan önce kısa bir süre bekle (visual feedback için)
    setTimeout(() => {
      onClose();
    }, 300);
  };

  // Mood kartı render
  const renderMoodItem = ({ item }) => {
    const isSelected = selectedMood && selectedMood.id === item.id;

    return (
      <View
        style={[
          styles.moodCard,
          isSelected && {
            borderColor: item.color,
            borderWidth: 2,
            backgroundColor: `${item.color}15`,
          },
        ]}
      >
        {/* Popular Badge */}
        {item.isPopular && (
          <View style={styles.popularBadge}>
            <Text style={styles.popularBadgeText}>POPULAR</Text>
          </View>
        )}

        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.cardContent}
          onPress={() => handleMoodSelect(item)}
        >
          <View style={styles.emojiContainer}>
            <Text style={styles.emoji}>{item.emoji}</Text>
          </View>

          <Text
            style={[
              styles.moodName,
              isSelected && {
                color: item.color,
                fontWeight: "600",
              },
            ]}
          >
            {t(item.name)}
          </Text>

          {/* Selection indicator - kartın sağ tarafında */}
          {isSelected && (
            <View
              style={[
                styles.selectionIndicator,
                {
                  backgroundColor: `${item.color}20`,
                  borderColor: item.color,
                },
              ]}
            >
              <Ionicons name="checkmark" size={16} color={item.color} />
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{t("mood")}</Text>

          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#000" />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <FlatList
          data={moodData}
          renderItem={renderMoodItem}
          keyExtractor={(item) => item.id}
          numColumns={3}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.flatListContent}
          columnWrapperStyle={styles.row}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },

  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },

  modalTitle: {
    fontSize: 24,
    fontWeight: "600",
    color: "#000",
  },

  closeButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
  },

  flatListContent: {
    padding: 20,
  },

  row: {
    justifyContent: "space-between",
  },

  moodCard: {
    width: cardWidth,
    height: 100,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 8,
    marginBottom: 16,
  },

  cardContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },

  emojiContainer: {
    marginBottom: 8,
  },

  emoji: {
    fontSize: 32,
  },

  moodName: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6B7280",
    textAlign: "center",
    paddingHorizontal: 4,
  },

  selectionIndicator: {
    position: "absolute",
    top: 0,
    right: 0,
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },

  popularBadge: {
    position: "absolute",
    top: -8,
    left: -8,
    backgroundColor: "#F59E0B",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    zIndex: 10,
    borderWidth: 1,
    borderColor: "#fff",
  },

  popularBadgeText: {
    fontSize: 8,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.5,
  },
});

export default MoodModal;
