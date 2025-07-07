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

const EthnicityModal = ({
  isVisible,
  onClose,
  onEthnicitySelect,
  preSelectedEthnicity = null,
}) => {
  const { t } = useTranslation();
  const [selectedEthnicity, setSelectedEthnicity] =
    useState(preSelectedEthnicity);

  // Modal açıldığında seçili ethnicity'i güncelle
  useEffect(() => {
    if (isVisible) {
      setSelectedEthnicity(preSelectedEthnicity);
    }
  }, [isVisible, preSelectedEthnicity]);

  // Ethnicity verisi
  const ethnicityData = [
    {
      id: "caucasian",
      name: t("ethnicity_caucasian"),
      icon: "person-outline",
      color: "#10B981",
    },
    {
      id: "asian",
      name: t("ethnicity_asian"),
      icon: "person-outline",
      color: "#EF4444",
    },
    {
      id: "african",
      name: t("ethnicity_african"),
      icon: "person-outline",
      color: "#F59E0B",
    },
    {
      id: "hispanic",
      name: t("ethnicity_hispanic"),
      icon: "person-outline",
      color: "#EC4899",
    },
    {
      id: "middle_eastern",
      name: t("ethnicity_middle_eastern"),
      icon: "person-outline",
      color: "#8B5CF6",
    },
    {
      id: "native_american",
      name: t("ethnicity_native_american"),
      icon: "person-outline",
      color: "#84CC16",
    },
    {
      id: "pacific_islander",
      name: t("ethnicity_pacific_islander"),
      icon: "person-outline",
      color: "#06B6D4",
    },
    {
      id: "south_asian",
      name: t("ethnicity_south_asian"),
      icon: "person-outline",
      color: "#F97316",
    },
    {
      id: "east_asian",
      name: t("ethnicity_east_asian"),
      icon: "person-outline",
      color: "#6366F1",
    },
    {
      id: "southeast_asian",
      name: t("ethnicity_southeast_asian"),
      icon: "person-outline",
      color: "#14B8A6",
    },
    {
      id: "mixed",
      name: t("ethnicity_mixed"),
      icon: "people-outline",
      color: "#D946EF",
    },
    {
      id: "other",
      name: t("ethnicity_other"),
      icon: "ellipsis-horizontal-outline",
      color: "#6B7280",
    },
  ];

  // Ethnicity seçimi
  const handleEthnicitySelect = (ethnicity) => {
    setSelectedEthnicity(ethnicity);

    if (onEthnicitySelect) {
      onEthnicitySelect(ethnicity);
    }

    // Modal'ı kapatmadan önce kısa bir süre bekle (visual feedback için)
    setTimeout(() => {
      onClose();
    }, 300);
  };

  // Ethnicity kartı render
  const renderEthnicityItem = ({ item }) => {
    const isSelected = selectedEthnicity && selectedEthnicity.id === item.id;

    return (
      <View
        style={[
          styles.ethnicityCard,
          isSelected && {
            borderColor: item.color,
            borderWidth: 2,
            backgroundColor: `${item.color}15`,
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.cardContent}
          onPress={() => handleEthnicitySelect(item)}
        >
          <View style={styles.iconContainer}>
            <Ionicons name={item.icon} size={32} color={item.color} />
          </View>

          <Text
            style={[
              styles.ethnicityName,
              isSelected && {
                color: item.color,
                fontWeight: "600",
              },
            ]}
          >
            {item.name}
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
          <View style={styles.headerLeft}>
            <Text style={styles.modalTitle}>{t("select_ethnicity")}</Text>
            <Text style={styles.modalSubtitle}>
              {ethnicityData.length} {t("ethnicity_options_count")}
            </Text>
          </View>

          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#000" />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <FlatList
          data={ethnicityData}
          renderItem={renderEthnicityItem}
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

  headerLeft: {
    flex: 1,
  },

  modalTitle: {
    fontSize: 24,
    fontWeight: "600",
    color: "#000",
  },

  modalSubtitle: {
    fontSize: 14,
    fontWeight: "400",
    color: "#6B7280",
    marginTop: 4,
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

  ethnicityCard: {
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

  iconContainer: {
    marginBottom: 8,
  },

  ethnicityName: {
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
});

export default EthnicityModal;
